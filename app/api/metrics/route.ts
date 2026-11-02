import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { rollup } from '@/lib/log-retention';
import { toleranceSecondsBySource } from '@/lib/schedule';
import { isLocalCall } from '@/lib/request-origin';
import { safeTokenEqual } from '@/lib/safe-token';
import { intakeStats } from '@/lib/csp-intake';

export const dynamic = 'force-dynamic';

/**
 * Prometheus-format /metrics endpoint.
 *
 * Surfaces application-level gauges (content counts, search and MCP usage,
 * sync freshness) - system metrics (CPU, RSS) should come from
 * node_exporter or the equivalent platform agent.
 *
 * Auth: a caller on the box is always allowed - that is how the hourly
 * check-sync-staleness.sh cron reads it (BASE_URL=http://127.0.0.1:3130).
 * A caller from outside needs METRICS_TOKEN, as `?token=` or a bearer
 * header.
 *
 * IT USED TO FAIL OPEN. With METRICS_TOKEN unset (it was, on this box) the
 * endpoint was public - confirmed live: `curl nearpedia.example/api/metrics`
 * returned full operational telemetry (content counts, chat/search volume,
 * sync job names) with no auth at all. A default that publishes operational
 * telemetry when nobody has configured anything is the wrong default; the
 * local carve-out is what makes closing it safe without breaking the
 * on-box watchdog.
 */
function isAuthorized(req: Request): boolean {
  if (isLocalCall(req)) return true;
  const token = process.env.METRICS_TOKEN;
  if (!token) return false;
  const url = new URL(req.url);
  // Constant-time, both forms. It was `===`, which stops at the first byte that
  // differs and so answers faster the closer a guess gets.
  const auth = req.headers.get('authorization');
  return safeTokenEqual(url.searchParams.get('token'), token)
    || safeTokenEqual(auth?.startsWith('Bearer ') ? auth.slice(7) : null, token);
}

function fmt(name: string, value: number, help: string, type: 'gauge' | 'counter' = 'gauge', labels?: Record<string, string>): string {
  const labelStr = labels
    ? '{' + Object.entries(labels).map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`).join(',') + '}'
    : '';
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name}${labelStr} ${value}\n`;
}

interface CountRow { c: number }
interface MaxRow { t: string | null }

function safeCount(sql: string, ...params: unknown[]): number {
  try {
    const db = getDb();
    return (db.prepare(sql).get(...params) as CountRow).c;
  } catch { return 0; }
}

function safeMaxTimestamp(sql: string, ...params: unknown[]): number {
  try {
    const db = getDb();
    const row = db.prepare(sql).get(...params) as MaxRow;
    return row.t ? new Date(row.t).getTime() : 0;
  } catch { return 0; }
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const now = Date.now();
  const day = 86400_000;
  const lines: string[] = [];

  // Content counts (gauges)
  lines.push(fmt('nearpedia_forum_topics_total', safeCount('SELECT COUNT(*) as c FROM forum_topics'), 'Forum topics indexed'));
  lines.push(fmt('nearpedia_forum_posts_total', safeCount('SELECT COUNT(*) as c FROM forum_posts'), 'Forum posts indexed'));
  lines.push(fmt('nearpedia_docs_total', safeCount('SELECT COUNT(*) as c FROM doc_pages'), 'Documentation pages indexed'));
  lines.push(fmt('nearpedia_blog_posts_total', safeCount('SELECT COUNT(*) as c FROM blog_posts'), 'Blog posts indexed'));
  lines.push(fmt('nearpedia_videos_total', safeCount('SELECT COUNT(*) as c FROM youtube_videos'), 'YouTube videos indexed'));
  lines.push(fmt('nearpedia_github_items_total', safeCount('SELECT COUNT(*) as c FROM github_items'), 'GitHub issues and PRs indexed'));
  lines.push(fmt('nearpedia_github_discussions_total', safeCount('SELECT COUNT(*) as c FROM github_discussions'), 'GitHub Discussions indexed'));
  lines.push(fmt('nearpedia_radar_items_total', safeCount('SELECT COUNT(*) as c FROM radar_items'), 'Radar items'));
  lines.push(fmt('nearpedia_radar_critical', safeCount("SELECT COUNT(*) as c FROM radar_items WHERE level = 'critical' AND (expires_at IS NULL OR expires_at > datetime('now'))"), 'Active critical radar alerts'));
  lines.push(fmt('nearpedia_ecosystem_projects_total', safeCount('SELECT COUNT(*) as c FROM ecosystem_projects'), 'Ecosystem projects'));
  lines.push(fmt('nearpedia_embedding_chunks_total', safeCount('SELECT COUNT(*) as c FROM embedding_chunks'), 'RAG embedding chunks'));
  lines.push(fmt('nearpedia_youtube_transcripts_total', safeCount('SELECT COUNT(*) as c FROM youtube_videos WHERE transcript_text IS NOT NULL'), 'YouTube videos with transcripts'));

  // MCP usage (written by the MCP server's own writable handle).
  // + rollup(): scripts/prune-logs.ts deletes rows past 180 days and writes
  // their count to log_rollup first, so this lifetime figure doesn't walk
  // backwards the first night the pruner has something to take - Prometheus
  // reads a `_total` counter that decreases as a process restart and
  // discards every rate() computed across the drop.
  lines.push(fmt('nearpedia_mcp_calls_total', safeCount('SELECT COUNT(*) as c FROM mcp_calls') + rollup('mcp_calls', 'total'), 'MCP requests served since logging began', 'counter'));
  lines.push(fmt('nearpedia_mcp_calls_24h', safeCount("SELECT COUNT(*) as c FROM mcp_calls WHERE ts >= datetime('now','-1 day')"), 'MCP requests in the last 24h'));
  lines.push(fmt('nearpedia_mcp_calls_error_24h', safeCount("SELECT COUNT(*) as c FROM mcp_calls WHERE status IN ('error','tool_error') AND ts >= datetime('now','-1 day')"), 'Failed MCP requests in the last 24h'));

  // Search analytics.
  lines.push(fmt('nearpedia_search_total', safeCount('SELECT COUNT(*) as c FROM search_log') + rollup('search_log', 'total'), 'Total /search renders logged since launch', 'counter'));
  lines.push(fmt('nearpedia_search_24h', safeCount('SELECT COUNT(*) as c FROM search_log WHERE timestamp >= ?', now - day), 'Searches in the last 24h'));
  lines.push(fmt('nearpedia_search_zero_24h', safeCount('SELECT COUNT(*) as c FROM search_log WHERE timestamp >= ? AND result_count = 0', now - day), 'Searches in the last 24h that returned 0 results - content-gap signal'));

  // CSP violations - both a total counter and per-directive 7d slice
  // for alerting on a spike in a specific directive class.
  lines.push(fmt('nearpedia_csp_violations_total', safeCount('SELECT COUNT(*) as c FROM csp_violation_log') + rollup('csp_violation_log', 'total'), 'CSP violations reported since launch', 'counter'));
  lines.push(fmt('nearpedia_csp_violations_24h', safeCount('SELECT COUNT(*) as c FROM csp_violation_log WHERE timestamp >= ?', now - day), 'CSP violations reported in the last 24h - alertable'));
  try {
    const db = getDb();
    const directiveRows = db.prepare(`
      SELECT COALESCE(violated_directive, 'unknown') as directive, COUNT(*) as c
      FROM csp_violation_log
      WHERE timestamp >= ?
      GROUP BY directive
    `).all(now - 7 * day) as Array<{ directive: string; c: number }>;
    for (const r of directiveRows) {
      lines.push(fmt('nearpedia_csp_violations_by_directive_7d', r.c, 'CSP violations in the last 7d, by violated directive', 'gauge', { directive: r.directive }));
    }
  } catch { /* csp_violation_log not present on older DB */ }

  // What the intake refused, so a quiet violations gauge cannot mean "quiet
  // site" when it actually means "we stopped writing". In-memory since boot,
  // hence gauges: a restart resets them and that is not a counter reset to
  // reason about.
  const intake = intakeStats();
  lines.push(fmt('nearpedia_csp_reports_dropped_duplicate', intake.duplicate, 'CSP reports dropped since boot as a repeat of one already stored in the dedupe window'));
  lines.push(fmt('nearpedia_csp_reports_dropped_budget', intake.overBudget, 'CSP reports dropped since boot because the per-minute insert budget was spent - a flood'));
  lines.push(fmt('nearpedia_csp_reports_dropped_oversized', intake.oversized, 'CSP reports refused since boot for exceeding the body size limit'));

  // nearpedia_sync_completion_age_seconds is the liveness signal: seconds
  // since a source last COMPLETED, where completed means anything that
  // isn't 'error' - 'partial' is an honest permanent state for some sources
  // (a multi-feed crawler that's missing one dead feed forever), and judging
  // those by a success-only MAX would make them read as stale for ever.
  //
  // nearpedia_sync_tolerance_seconds is published alongside it, both derived
  // from deploy/sync-tick.sh + sync-cf.sh in lib/schedule.ts, so
  // check-sync-staleness.sh has no second copy of the schedule to drift out
  // of sync with this one - which is exactly what happened before this pair
  // existed: a hand-typed threshold table in the shell script, keyed by
  // script name against a gauge labelled by source name, where most keys
  // never matched and every one of those sources was silently judged by a
  // 24h fallback instead of its real cadence.
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT source, MAX(ran_at) as t FROM sync_log WHERE status != 'error' GROUP BY source"
    ).all() as Array<{ source: string; t: string | null }>;
    const tolerance = toleranceSecondsBySource();
    for (const r of rows) {
      const ageSec = r.t ? Math.floor((now - new Date(r.t).getTime()) / 1000) : -1;
      lines.push(fmt('nearpedia_sync_completion_age_seconds', ageSec, "Seconds since the source last completed, where an error is not a completion", 'gauge', { source: r.source }));
      const tol = tolerance.get(r.source);
      // A source with no tolerance is not on a schedule - a one-off
      // migration or backfill - and has no cadence to be late against.
      if (tol !== undefined) {
        lines.push(fmt('nearpedia_sync_tolerance_seconds', tol, 'How long this scheduled source may go without completing, from its cron bucket', 'gauge', { source: r.source }));
      }
    }
  } catch { /* sync_log or schedule not ready */ }

  // Latest network snapshot ages
  lines.push(fmt('nearpedia_network_snapshot_age_seconds', Math.max(0, Math.floor((now - safeMaxTimestamp('SELECT MAX(snapshot_at) as t FROM network_stats')) / 1000)), 'Seconds since the latest content-metrics snapshot'));
  // On-chain state and NEAR market are fetched live from Explorer/CoinGecko per
  // request (lib/onchain.ts) and never stored, so there is no snapshot age to
  // report. The gauges that used to live here queried network_state and
  // token_market - NEAR-era tables that do not exist - so safeMaxTimestamp
  // returned 0 and both reported ~1.78e9 seconds, i.e. a permanent false alarm.

  return new NextResponse(lines.join(''), {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
