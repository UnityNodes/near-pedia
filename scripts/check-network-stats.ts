/**
 * The network_stats snapshot must count what nearpedia actually holds.
 *
 * THE ORACLE. sync-network-stats.ts writes a periodic snapshot that
 * /api/v1/network and other summary surfaces read instead of re-querying
 * every table on every request. Every metric in that snapshot has a clean
 * live recount, so this recomputes each one from the tables directly and
 * compares it to the stored figure.
 *
 * The snapshot lags live by however long since sync-network-stats last ran
 * (the slow bucket, every 6h - deploy/sync-tick.sh), so the comparison is
 * bounded: a structural miscount (a WHERE clause that silently drops a whole
 * category) is far outside a few hours of real drift, while normal lag is
 * inside it. A dead writer that lets the snapshot rot past the bound is
 * caught here too, and separately by check-writers-succeeding.
 *
 * github_items is recounted as one population, mirroring the snapshot's
 * actual shape, with no per-repo split that would silently zero every
 * comparison.
 *
 *   npx tsx scripts/check-network-stats.ts
 *   npx tsx scripts/check-network-stats.ts --verbose
 */

import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { isoNowSql } from '../lib/formats';

const VERBOSE = process.argv.includes('--verbose');

async function main(): Promise<void> {
  const db = getDb();
  const problems: string[] = [];
  const c = (sql: string): number => (db.prepare(sql).get() as { c: number }).c;

  const snap = db.prepare('SELECT * FROM network_stats ORDER BY snapshot_at DESC LIMIT 1').get() as Record<string, number | string> | undefined;
  if (!snap) {
    logRun('check-network-stats', { status: 'partial', items: 0, error: 'no network_stats snapshot yet' }, db);
    console.log('[check-network-stats] no snapshot yet');
    return;
  }

  // Each snapshot column and the live count it must reflect. Mirrors
  // sync-network-stats.ts's own SELECTs exactly - see scripts/sync-network-stats.ts.
  const metrics: Array<{ key: string; live: number }> = [
    { key: 'cips', live: c('SELECT COUNT(*) c FROM cips') },
    { key: 'cips_in_review', live: c("SELECT COUNT(*) c FROM cips WHERE status = 'In Review'") },
    { key: 'cips_final', live: c("SELECT COUNT(*) c FROM cips WHERE status IN ('Final', 'Active', 'Approved')") },
    { key: 'forum_topics', live: c('SELECT COUNT(*) c FROM forum_topics') },
    { key: 'forum_posts', live: c('SELECT COUNT(*) c FROM forum_posts') },
    { key: 'github_items_open', live: c("SELECT COUNT(*) c FROM github_items WHERE state = 'open'") },
    { key: 'github_items_closed', live: c("SELECT COUNT(*) c FROM github_items WHERE state = 'closed'") },
    { key: 'docs', live: c('SELECT COUNT(*) c FROM doc_pages') },
    { key: 'videos', live: c('SELECT COUNT(*) c FROM youtube_videos') },
    { key: 'blog_posts', live: c('SELECT COUNT(*) c FROM blog_posts') },
    // Same boundary as sync-network-stats.ts's isoNowSql() fix, deliberately:
    // an oracle built on the old datetime('now') text-comparison would agree
    // with a writer that made the exact same mistake and never catch it.
    { key: 'radar_critical', live: c(`SELECT COUNT(*) c FROM radar_items WHERE level = 'critical' AND (expires_at IS NULL OR expires_at > ${isoNowSql()})`) },
    { key: 'radar_important', live: c(`SELECT COUNT(*) c FROM radar_items WHERE level = 'important' AND (expires_at IS NULL OR expires_at > ${isoNowSql()})`) },
  ];

  for (const m of metrics) {
    const stored = Number(snap[m.key] ?? NaN);
    if (Number.isNaN(stored)) { problems.push(`network_stats has no column ${m.key}`); continue; }
    // Lag bound: comfortably above a few hours of real change, far below a
    // structural drop.
    const bound = Math.max(30, Math.round(m.live * 0.03));
    const diff = stored - m.live;
    if (VERBOSE) console.error(`  ${m.key.padEnd(20)} snapshot=${stored} live=${m.live} diff=${diff} bound=±${bound}`);
    if (Math.abs(diff) > bound) {
      problems.push(`${m.key}: snapshot ${stored} vs live ${m.live} (off by ${diff}, bound ±${bound}) - the catalogue disagrees with the tables`);
    }
  }

  console.log(`[check-network-stats] snapshot ${String(snap.snapshot_at).slice(0, 19)}: ${metrics.length} metric(s) vs live; ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  NETSTATS  ${p}`);

  logRun('check-network-stats', {
    status: problems.length ? 'error' : 'success',
    items: metrics.length,
    error: problems.join(' ; ').slice(0, 1000) || undefined,
  }, db);

  if (problems.length) process.exitCode = 1;
}

main().catch(err => {
  console.error(err);
  logRun('check-network-stats', { status: 'error', items: 0, error: String(err).slice(0, 500) }, getDb());
  process.exitCode = 1;
});
