/**
 * One place that decides whether a sync run counts as healthy.
 *
 * WHY. A provenance audit on 2026-07-30 found that a green sync log was
 * meaningless: 24 of 44 scheduled scripts never wrote to `sync_log` at all, and
 * of the 20 that did, only 5 could ever write `status='error'`. The other 15 ran
 * an unconditional `INSERT ... 'success'` at the end of `main()`, which reports
 * on reaching the last line rather than on having done the work. So
 * `SELECT status, COUNT(*) FROM sync_log` read `success 134024 / error 4050`,
 * and every one of the 4050 belonged to those 5 sources.
 *
 * What that hid: a 15-day documentation outage where 59 consecutive runs each
 * failed on the same foreign key and each logged success, an 11-day stall in
 * mailing_threads whose writer is in no cron bucket, a missing weekly digest,
 * and 85 days of frozen attachments. All four were byte-identical to health.
 *
 * The inversion worth remembering: the source with the alarming 3094-error count
 * was the healthiest table in its group, because it was the only one able to
 * speak. Loud is not sick. Silent is unknown.
 *
 * THREE STATUSES, and the middle one is the point:
 *   success  the run did what it set out to do
 *   partial  some of it worked; `error` names what did not. Multi-source
 *            crawlers need this, because "one of nine feeds is gone" is neither
 *            success nor failure and collapsing it either way loses the signal.
 *   error    the run did not complete
 */

import type Database from 'better-sqlite3';
import { getDb } from './db';

export type RunStatus = 'success' | 'partial' | 'error';

export interface RunResult {
  status: RunStatus;
  items?: number;
  /** Why it is not a clean success. Required for partial and error. */
  error?: string;
}

/**
 * `sync_log` predates having anywhere to put a reason, so a failure recorded the
 * word "error" and nothing else. Added here rather than in a migration script so
 * that any caller of this module gets the column, including a sync run on a
 * database restored from an older backup.
 */
function ensureSchema(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(sync_log)`).all() as { name: string }[];
  if (!cols.some(c => c.name === 'error')) {
    db.exec(`ALTER TABLE sync_log ADD COLUMN error TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_log_source_ran ON sync_log (source, ran_at DESC)`);
}

/** Keep the message useful in a terminal and bounded in a column. */
function describe(err: unknown): string {
  if (err instanceof Error) {
    const first = (err.stack ?? '').split('\n').slice(0, 3).join(' | ');
    return (first || err.message).slice(0, 1000);
  }
  return String(err).slice(0, 1000);
}

/**
 * Row cap per source. The table reached 138,012 rows with no writer ever
 * pruning it, which is what a 5-minute cadence does over a year. Errors and
 * partials are never dropped: a failure from four months ago is the evidence
 * that a problem is old, and that is exactly the question this table exists to
 * answer.
 */
const KEEP_PER_SOURCE = 1000;

function trim(db: Database.Database, source: string): void {
  const n = (
    db.prepare(`SELECT COUNT(*) AS n FROM sync_log WHERE source = ? AND status = 'success'`).get(source) as { n: number }
  ).n;
  // Only sweep once the source is meaningfully over the cap, so a 5-minute sync
  // is not running a delete on every tick.
  if (n <= KEEP_PER_SOURCE * 1.2) return;
  db.prepare(
    `DELETE FROM sync_log
      WHERE source = ? AND status = 'success' AND id NOT IN (
        SELECT id FROM sync_log WHERE source = ? AND status = 'success'
        ORDER BY ran_at DESC LIMIT ?
      )`,
  ).run(source, source, KEEP_PER_SOURCE);
}

export function logRun(source: string, result: RunResult, dbOverride?: Database.Database): void {
  const db = dbOverride ?? getDb();
  ensureSchema(db);
  // NULL, not 0, when the caller reported no count. Writing 0 says "this run
  // handled nothing", which is a measurement; the truth is that the script did
  // not say. That distinction is the whole subject of the audit this module came
  // out of, so it would be poor form to reintroduce it here.
  db.prepare(
    `INSERT INTO sync_log (source, status, items_synced, ran_at, error) VALUES (?, ?, ?, ?, ?)`,
  ).run(source, result.status, result.items ?? null, new Date().toISOString(), result.error ?? null);
  if (result.status === 'success') trim(db, source);
}

export const STUCK_PARTIAL_RUNS = 3;

export interface StuckPartial {
  source: string;
  runs: number;
  since: string;
  error: string | null;
}

interface RecentRun { source: string | null; status: string; error: string | null; ran_at: string }

function errorShape(error: string | null): string {
  return (error ?? '').replace(/\d+/g, '#');
}

export function stuckPartials(
  db: Database.Database,
  runs: number = STUCK_PARTIAL_RUNS,
  sources?: readonly string[],
): StuckPartial[] {
  const hasLog = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_log'").get();
  if (!hasLog) return [];
  const cols = (db.prepare('PRAGMA table_info(sync_log)').all() as { name: string }[]).map(c => c.name);
  const errorCol = cols.includes('error') ? 'error' : 'NULL';
  const wanted = sources ? sources.filter(s => !s.endsWith('%')) : null;
  const recent = db.prepare(
    `SELECT source, status, error, ran_at FROM (
       SELECT source, status, ${errorCol} AS error, ran_at,
              ROW_NUMBER() OVER (PARTITION BY source ORDER BY ran_at DESC, id DESC) AS rn
         FROM sync_log
        ${wanted ? 'WHERE source IN (SELECT value FROM json_each(?))' : ''}
     ) WHERE rn <= ? ORDER BY source, rn`,
  ).all(...(wanted ? [JSON.stringify(wanted), runs] : [runs])) as RecentRun[];

  const bySource = new Map<string, RecentRun[]>();
  for (const r of recent) {
    if (r.source === null) continue;
    bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);
  }

  const out: StuckPartial[] = [];
  for (const [source, last] of bySource) {
    if (last.length < runs || !last.every(r => r.status === 'partial')) continue;
    if (new Set(last.map(r => errorShape(r.error))).size !== 1) continue;
    out.push({ source, runs: last.length, since: last[last.length - 1].ran_at, error: last[0].error });
  }
  return out;
}

/**
 * Wrap a sync's entry point so a crash is recorded instead of being reported by
 * absence.
 *
 * On failure it always writes an `error` row. On success it writes a `success`
 * row ONLY if the script did not already write one for this source, which is
 * detected by watching for a new row rather than by coordinating with the
 * script. That lets the 24 silent scripts start reporting without touching their
 * bodies, and leaves the 20 that already log alone rather than doubling their
 * rows.
 *
 * The error is rethrown: the caller still decides the exit code, and a non-zero
 * exit is what the cron log shows.
 */
/**
 * For a script whose work sits at module top level with no entry function to
 * wrap. Call it near the top; call `logRun(source, {status:'success'})` at the
 * bottom. A crash anywhere in between is recorded and the exit code is set.
 *
 * The alternative was to fold each such body into an async main(), which means
 * re-indenting the whole file. Two lines at the ends is a smaller thing to get
 * wrong.
 */
export function logRunOnCrash(source: string): void {
  const report = (err: unknown) => {
    // Already crashing; a logging failure must not replace the real error.
    try {
      logRun(source, { status: 'error', error: describe(err) });
    } catch {
      /* ignore */
    }
    console.error(`[${source}] failed:`, err);
    process.exitCode = 1;
  };
  process.once('uncaughtException', report);
  process.once('unhandledRejection', report);
}

export async function guardSync<T>(
  source: string,
  // Accepts a synchronous entry point too. Two scripts have a plain `main()`
  // that returns void, and typing this as Promise-only made wrapping them a
  // type error that nothing surfaced, because tsconfig excludes scripts/.
  fn: () => T | Promise<T>,
  dbOverride?: Database.Database,
): Promise<T> {
  const db = dbOverride ?? getDb();
  ensureSchema(db);
  const highWater = (
    db.prepare(`SELECT COALESCE(MAX(id), 0) AS id FROM sync_log`).get() as { id: number }
  ).id;

  try {
    const out = await fn();
    // The work is done. A logging problem must not turn a successful run into a
    // failed one, and must not be silent either: refresh-trending closes the
    // connection on its way out, which made the success write throw after the
    // sync had already succeeded.
    try {
      const live = dbOverride ?? getDb();
      const wroteItsOwn = (
        live.prepare(`SELECT COUNT(*) AS n FROM sync_log WHERE id > ? AND source = ?`).get(highWater, source) as {
          n: number;
        }
      ).n;
      // A wrapped entry point that returns a count gets it recorded; one that
      // returns void leaves items_synced NULL rather than 0.
      if (!wroteItsOwn) {
        logRun(source, { status: 'success', items: typeof out === 'number' ? out : undefined }, live);
      }
    } catch (logErr) {
      console.error(`[${source}] run succeeded but could not be logged:`, logErr);
    }
    return out;
  } catch (err) {
    logRun(source, { status: 'error', error: describe(err) }, db);
    throw err;
  }
}
