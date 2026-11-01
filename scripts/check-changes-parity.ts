/**
 * The recent-activity feed is served two ways and must be the SAME feed: the
 * same kinds of event, each event once, in the same time order.
 *
 * Investigation found this bug in yourpedia: three
 * real CIPs (0050, 0051, 0052) were double-counted in /api/v1/changes' merged
 * stream within a 90-day window (once as cip_status_change "(new) -> Draft",
 * once as new_cip), and get_recent_changes (the MCP tool) was worse - no
 * new_cip kind at all, and no new_radar_item kind either, though
 * /api/v1/changes already carried one. Fixed alongside this check, rather
 * than left broken with a check pointed at a road that can't agree with
 * itself.
 *
 * THE CLASS. get_recent_changes and /api/v1/changes each build a merged
 * activity stream from several per-source queries. The SOURCE SET and the
 * predicates each query uses can drift independently between the two roads.
 *
 * THE FIX (both roads): cip_status_change is transitions only (from_status IS
 * NOT NULL), new_cip is arrivals. This check holds that line.
 *
 * ASSERTS (structural parts are exact and clock-skew-free; totals carry a
 * small tolerance because each road samples its own `now` a moment apart):
 *   - both roads present the SAME SET of event kinds for the window
 *   - no arrival is also listed as a cip_status_change (same CIP, same instant), on
 *     either road. A CIP that arrives and is then approved inside the window has two
 *     different events and is not a double-count.
 *   - both roads are ordered newest-first by PARSED time
 *   - REST total, get_recent_changes total and the raw kind-count agree (+/-2)
 *
 *   npx tsx scripts/check-changes-parity.ts
 *   npx tsx scripts/check-changes-parity.ts --verbose
 */

import { startScratchMcp } from '../lib/mcp-probe';
import { logRun } from '../lib/sync-log';
import { getDb } from '../lib/db';

const VERBOSE = process.argv.includes('--verbose');
const WINDOWS = [30, 90];

interface RestItem { kind: string; when: string; meta?: { cip_id?: string } }

async function main(): Promise<void> {
  const problems: string[] = [];
  const record = (m: string) => problems.push(m);

  const mcp = await startScratchMcp({ label: 'check-changes-parity' });
  try {
    const base = `http://127.0.0.1:${mcp.port}`;
    const snap = mcp.snapshot;
    const c = (sql: string, ...p: unknown[]) => (snap.prepare(sql).get(...p) as { c: number }).c;

    for (const days of WINDOWS) {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      // Independent raw anchor: the six kinds, arrivals and transitions split.
      const anchor = {
        cip_status_change: c('SELECT COUNT(*) c FROM cip_status_history WHERE changed_at >= ? AND from_status IS NOT NULL', since),
        new_cip: c('SELECT COUNT(*) c FROM (SELECT cip_id FROM cip_status_history WHERE from_status IS NULL GROUP BY cip_id HAVING MIN(changed_at) >= ?)', since),
        new_forum_topic: c('SELECT COUNT(*) c FROM forum_topics WHERE created_at >= ?', since),
        new_blog_post: c('SELECT COUNT(*) c FROM blog_posts WHERE published_at >= ?', since),
        new_release: c('SELECT COUNT(*) c FROM github_releases WHERE published_at >= ?', since),
        new_radar_item: c('SELECT COUNT(*) c FROM radar_items WHERE published_at >= ?', since),
      };
      const anchorTotal = Object.values(anchor).reduce((a, b) => a + b, 0);

      // REST road
      const restRes = await fetch(`${base}/api/v1/changes?days=${days}&limit=1000`);
      const rest = await restRes.json() as { total: number; counts?: Record<string, number>; items: RestItem[] };
      // MCP road
      const txt = await mcp.callTool('get_recent_changes', { days, limit: 200 });
      const mcpTotalM = txt.match(/showing \d+ of (\d+) events/);
      const mcpTotal = mcpTotalM ? parseInt(mcpTotalM[1], 10) : NaN;
      // parse MCP items: "[YYYY-MM-DD HH:MM] (kind) title"
      const mcpItems = [...txt.matchAll(/^\[([0-9 :-]+)\]\s*\(([a-z_]+)\)\s*(.*)$/gm)].map(m => ({ when: m[1], kind: m[2], title: m[3] }));

      if (VERBOSE) console.error(`  ${days}d: anchor=${anchorTotal} REST=${rest.total} MCP=${mcpTotal} restItems=${rest.items.length} mcpItems=${mcpItems.length}`);

      // 1. same set of kinds
      const restKinds = new Set(rest.items.map(i => i.kind));
      const mcpKinds = new Set(mcpItems.map(i => i.kind));
      for (const k of restKinds) if (!mcpKinds.has(k)) record(`${days}d: kind "${k}" present in /api/v1/changes but not get_recent_changes`);
      for (const k of mcpKinds) if (!restKinds.has(k)) record(`${days}d: kind "${k}" present in get_recent_changes but not /api/v1/changes`);

      // 2. no CIP double: appears as both cip_status_change and new_cip
      const restDouble = doubleCip(rest.items.map(i => ({ kind: i.kind, cip: i.meta?.cip_id, when: i.when })));
      if (restDouble) record(`${days}d: /api/v1/changes shows CIP ${restDouble} as both cip_status_change and new_cip`);
      const mcpDouble = doubleCip(mcpItems.map(i => ({ kind: i.kind, cip: (i.title.match(/CIP-([\w-]+)/) ?? [])[1], when: i.when })));
      if (mcpDouble) record(`${days}d: get_recent_changes shows CIP ${mcpDouble} as both cip_status_change and new_cip`);

      // 3. newest-first by parsed time, both roads
      if (!ordered(rest.items.map(i => i.when))) record(`${days}d: /api/v1/changes is not newest-first by parsed time`);
      if (!ordered(mcpItems.map(i => i.when))) record(`${days}d: get_recent_changes is not newest-first by parsed time`);

      // 4. totals agree within skew tolerance
      if (Math.abs(rest.total - anchorTotal) > 2) record(`${days}d: /api/v1/changes total ${rest.total} != raw kind-count ${anchorTotal}`);
      if (!Number.isNaN(mcpTotal) && Math.abs(mcpTotal - anchorTotal) > 2) record(`${days}d: get_recent_changes total ${mcpTotal} != raw kind-count ${anchorTotal}`);
      if (!Number.isNaN(mcpTotal) && Math.abs(rest.total - mcpTotal) > 2) record(`${days}d: road totals disagree REST ${rest.total} vs MCP ${mcpTotal}`);

      // 5. REST per-kind counts match the anchor (REST publishes a counts object)
      if (rest.counts) {
        for (const [k, v] of Object.entries(anchor)) {
          const got = rest.counts[k] ?? 0;
          if (Math.abs(got - v) > 2) record(`${days}d: /api/v1/changes counts.${k}=${got} != raw ${v}`);
        }
      }
    }
  } finally {
    mcp.close();
  }

  console.log(`[check-changes-parity] ${WINDOWS.length} window(s) across both roads; ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  CHANGES  ${p}`);

  logRun('check-changes-parity', {
    status: problems.length ? 'error' : 'success',
    items: WINDOWS.length,
    error: problems.join(' ; ').slice(0, 1000) || undefined,
  }, getDb());

  if (problems.length) process.exitCode = 1;
}

function doubleCip(items: Array<{ kind: string; cip?: string; when: string }>): string | null {
  const arrivedAt = new Map<string, Set<string>>();
  for (const it of items) {
    if (it.cip && it.kind === 'new_cip') {
      const seen = arrivedAt.get(it.cip) ?? new Set<string>();
      seen.add(it.when);
      arrivedAt.set(it.cip, seen);
    }
  }
  for (const it of items) {
    if (it.cip && it.kind === 'cip_status_change' && arrivedAt.get(it.cip)?.has(it.when)) return it.cip;
  }
  return null;
}

function ordered(whens: string[]): boolean {
  for (let i = 1; i < whens.length; i++) {
    const a = Date.parse(whens[i - 1].replace(' ', 'T')), b = Date.parse(whens[i].replace(' ', 'T'));
    if (!Number.isNaN(a) && !Number.isNaN(b) && b > a) return false;
  }
  return true;
}

main().catch(err => {
  console.error(err);
  logRun('check-changes-parity', { status: 'error', items: 0, error: String(err).slice(0, 500) }, getDb());
  process.exitCode = 1;
});
