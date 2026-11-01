/**
 * Bound the log tables, without moving a single published number.
 *
 * Four tables grow forever and sync_log has no cap at all (four scripts
 * write it with raw SQL, bypassing lib/sync-log.ts). See lib/log-retention.ts
 * for the measurements and the policy; this is the half that runs.
 *
 * ORDER MATTERS AND IS THE WHOLE POINT. For every table the rollup is written
 * FIRST and the rows are deleted second, inside one transaction. Reversed, or
 * split across two transactions with a crash between them, the totals on
 * /api/metrics would silently drop by however much was removed. The
 * aggregate is computed over exactly the rows the DELETE will take, from the
 * same cutoff, so there is no window in which a row is counted twice or not
 * at all.
 *
 * It is safe to run repeatedly: a second run over the same day finds nothing
 * past the cutoff and adds nothing.
 *
 *   npx tsx scripts/prune-logs.ts
 *   npx tsx scripts/prune-logs.ts --dry-run    # count what would go, delete nothing
 *
 * The database FILE will not shrink, and that is fine. SQLite marks freed
 * pages for reuse rather than returning them to the OS, so the effect is
 * that the file stops growing rather than that it gets smaller. VACUUM would
 * reclaim the space and takes an exclusive lock on a database serving live
 * traffic, which is a worse trade than a file that has stopped growing.
 */

import { getDb } from '../lib/db';
import { guardSync } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { RETENTION, ROLLUPS, SYNC_LOG_KEEP_PER_SOURCE, ensureRollupSchema } from '../lib/log-retention';

const DRY_RUN = process.argv.includes('--dry-run');

function main(): number {
  const db = getDb();
  ensureRollupSchema(db);

  const now = Date.now();
  const lines: string[] = [];
  let deleted = 0;

  for (const p of RETENTION) {
    const cutoffMs = now - p.days * 86_400_000;
    const cutoff = p.timeKind === 'epoch_ms' ? cutoffMs : new Date(cutoffMs).toISOString();
    const where = `${p.timeColumn} < ${p.timeKind === 'epoch_ms' ? cutoffMs : `'${cutoff}'`}`;

    let doomed = 0;
    try {
      doomed = (db.prepare(`SELECT COUNT(*) c FROM "${p.table}" WHERE ${where}`).get() as { c: number }).c;
    } catch {
      lines.push(`  ${p.table}: table absent, skipped`);
      continue;
    }
    if (doomed === 0) { lines.push(`  ${p.table}: nothing older than ${p.days}d`); continue; }

    // Oldest row about to go, so "recording since" could be preserved by a
    // future reader (not read by anything today, but cheap to keep).
    const oldest = (db.prepare(`SELECT MIN(${p.timeColumn}) t FROM "${p.table}" WHERE ${where}`).get() as { t: number | string | null }).t;
    const oldestMs = typeof oldest === 'number' ? oldest : oldest ? Date.parse(String(oldest)) : null;

    const metrics = ROLLUPS[p.table] ?? [];
    const contributions = metrics.map(m => ({
      metric: m.metric,
      value: (db.prepare(m.sql(where)).get() as { v: number }).v ?? 0,
    }));

    if (DRY_RUN) {
      lines.push(`  ${p.table}: would delete ${doomed}, roll up ${contributions.map(c => `${c.metric}+${c.value}`).join(' ') || '(no metrics)'}`);
      continue;
    }

    // One transaction: the totals and the rows move together or not at all.
    db.transaction(() => {
      for (const c of contributions) {
        db.prepare(`
          INSERT INTO log_rollup (table_name, metric, value, since_ms, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(table_name, metric) DO UPDATE SET
            value = value + excluded.value,
            since_ms = MIN(COALESCE(since_ms, excluded.since_ms), COALESCE(excluded.since_ms, since_ms)),
            updated_at = excluded.updated_at
        `).run(p.table, c.metric, c.value, oldestMs, new Date().toISOString());
      }
      db.prepare(`DELETE FROM "${p.table}" WHERE ${where}`).run();
    })();

    deleted += doomed;
    lines.push(`  ${p.table}: deleted ${doomed} older than ${p.days}d, rolled up ${contributions.map(c => `${c.metric}+${c.value}`).join(' ') || '(no metrics)'}`);
  }

  // sync_log: a cap per source, enforced here rather than on the write path.
  //
  // lib/sync-log.ts's recordSync() never trims, and four scripts (check-
  // scheduled.ts, sync-docs.ts, sync-cips.ts, sync-github-releases.ts) write
  // sync_log with raw SQL and would bypass a cap even if one existed there.
  // Enforcing it against the table instead means no writer can opt out by
  // choosing different SQL. Failures are never touched: an error from months
  // ago is the evidence that a problem is old, and nothing here rolls them
  // up because nothing on /api/metrics counts them in aggregate.
  const overCap = db.prepare(`
    SELECT source, COUNT(*) n FROM sync_log WHERE status = 'success'
    GROUP BY source HAVING n > ?
  `).all(SYNC_LOG_KEEP_PER_SOURCE) as Array<{ source: string; n: number }>;

  let syncDeleted = 0;
  for (const s of overCap) {
    const excess = s.n - SYNC_LOG_KEEP_PER_SOURCE;
    if (DRY_RUN) { lines.push(`  sync_log/${s.source}: would delete ${excess} successes (${s.n} held, cap ${SYNC_LOG_KEEP_PER_SOURCE})`); continue; }
    db.prepare(`
      DELETE FROM sync_log
       WHERE source = ? AND status = 'success' AND id NOT IN (
         SELECT id FROM sync_log WHERE source = ? AND status = 'success'
         ORDER BY ran_at DESC LIMIT ?
       )
    `).run(s.source, s.source, SYNC_LOG_KEEP_PER_SOURCE);
    syncDeleted += excess;
  }
  if (overCap.length && !DRY_RUN) lines.push(`  sync_log: deleted ${syncDeleted} excess successes across ${overCap.length} source(s); failures untouched`);
  if (!overCap.length) lines.push('  sync_log: every source within cap');

  console.log(`[prune-logs] ${DRY_RUN ? 'DRY RUN, nothing deleted' : `${deleted + syncDeleted} rows deleted`}`);
  for (const l of lines) console.log(l);

  return deleted + syncDeleted;
}

if (isEntrypoint(import.meta.url)) {
  if (DRY_RUN) {
    main();
  } else {
    guardSync('prune-logs', main).catch(e => { console.error(e); process.exit(1); });
  }
}
