/**
 * How long each log table keeps rows, and what survives the delete.
 *
 * THREE TABLES GROW WITHOUT BOUND. Measured 2026-08-03: mcp_calls 17308 rows
 * over 16 days (~1080/day, the fastest grower and a Prometheus `counter` on
 * /metrics), search_log 22, csp_violation_log 111. Small today;
 * mcp_calls alone is on pace for ~200k rows within 180 days.
 *
 * SYNC_LOG HAS NO RETENTION AT ALL, AND FOUR SCRIPTS WRITE IT WITH RAW SQL.
 * lib/sync-log.ts's recordSync()/withSyncLog() never trim anything - there is
 * no cap to bypass, but check-scheduled.ts, sync-docs.ts and
 * sync-github-releases.ts all also do `INSERT INTO sync_log` directly. The
 * lesson: a rule that lives on the write path only binds the writers that go
 * through it.
 * github-releases alone already holds 4459 successes (every-15-min cadence,
 * no cap, ~96/day). So the cap goes on the table via a scheduled prune, not
 * inside recordSync - nothing can opt out of a rule enforced against the
 * data itself.
 *
 * WHY DELETING IS NOT ENOUGH. /api/metrics publishes several of these as
 * Prometheus counters with no time bound - nearpedia_mcp_calls_total,
 * nearpedia_search_total, nearpedia_csp_violations_total. Deleting old rows would walk every one of
 * them backwards, and Prometheus reads a `_total` that decreases as a process
 * restart: every rate() computed across the drop gets discarded, which looks
 * like lost traffic that never actually happened. So the aggregate is written
 * to `log_rollup` BEFORE the rows go, and readers add it back for the
 * lifetime (null-window) figure only - a windowed (24h/7d) query is already
 * bounded to rows a 180-day prune can't touch, so it never needs the rollup.
 */

import type Database from 'better-sqlite3';
import { getDb } from './db';

export interface RetentionPolicy {
  table: string;
  /** Column holding the row's time, and whether it is epoch ms or an ISO string. */
  timeColumn: string;
  timeKind: 'epoch_ms' | 'iso';
  days: number;
  /** Why this window and not another. */
  why: string;
}

/**
 * 180 days. Long enough that a season-over-season question is still
 * answerable from live rows, short enough to keep mcp_calls (the fastest
 * grower) under a few hundred thousand rows rather than unbounded. The
 * rollup carries the lifetime totals past the window either way, so this
 * trades live detail for size, never a published number.
 */
const DAYS = 180;

export const RETENTION: RetentionPolicy[] = [
  { table: 'mcp_calls',         timeColumn: 'ts',        timeKind: 'iso',      days: DAYS, why: 'MCP request log; ~1080 rows/day, the fastest grower, and a Prometheus counter' },
  { table: 'search_log',        timeColumn: 'timestamp', timeKind: 'epoch_ms', days: DAYS, why: '/search analytics; small today, kept in step' },
  { table: 'csp_violation_log', timeColumn: 'timestamp', timeKind: 'epoch_ms', days: DAYS, why: 'CSP reports; a violation older than six months is not being acted on' },
];

/**
 * sync_log is not in RETENTION because its rule is different in kind: a cap
 * per source rather than an age, and FAILURES ARE NEVER DROPPED. An error
 * from months ago is the evidence that a problem is old, which is the main
 * question the table exists to answer.
 */
export const SYNC_LOG_KEEP_PER_SOURCE = 1000;

export interface RollupMetric {
  metric: string;
  /** Contribution of the rows the DELETE is about to take. */
  sql: (where: string) => string;
}

/**
 * What each table's prune must roll up before deleting, matched one-to-one
 * against every lifetime ("_total" / "since launch") figure app/api/metrics/
 * route.ts publishes for that table. A metric read but never written here is
 * silently zero from a live-only query, which is how a counter halves
 * without anyone noticing until the night the pruner first has something to
 * take.
 */
export const ROLLUPS: Record<string, RollupMetric[]> = {
  mcp_calls: [
    { metric: 'total', sql: w => `SELECT COUNT(*) v FROM mcp_calls WHERE ${w}` },
  ],
  search_log: [
    { metric: 'total', sql: w => `SELECT COUNT(*) v FROM search_log WHERE ${w}` },
  ],
  csp_violation_log: [
    { metric: 'total', sql: w => `SELECT COUNT(*) v FROM csp_violation_log WHERE ${w}` },
  ],
};

export function ensureRollupSchema(db: Database.Database): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS log_rollup (
      table_name TEXT NOT NULL,
      metric     TEXT NOT NULL,
      value      INTEGER NOT NULL DEFAULT 0,
      -- Oldest row this rollup has ever absorbed, so "recording since" would
      -- survive a delete that could otherwise walk MIN(timestamp) forward.
      since_ms   INTEGER,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (table_name, metric)
    )
  `).run();
}

/** Rolled-up value for one metric, or 0 when nothing has been pruned yet. */
export function rollup(table: string, metric: string, dbOverride?: Database.Database): number {
  const db = dbOverride ?? getDb();
  try {
    const r = db.prepare('SELECT value FROM log_rollup WHERE table_name = ? AND metric = ?').get(table, metric) as { value: number } | undefined;
    return r?.value ?? 0;
  } catch {
    // The table may not exist yet on a fresh install. Zero is the honest
    // answer there: nothing has been pruned, so nothing is missing.
    return 0;
  }
}

/** Oldest timestamp ever pruned away from any of the given tables, or null if none. */
export function rollupSince(tables: string[], dbOverride?: Database.Database): number | null {
  const db = dbOverride ?? getDb();
  try {
    const marks = tables
      .map(t => (db.prepare('SELECT MIN(since_ms) m FROM log_rollup WHERE table_name = ?').get(t) as { m: number | null }).m)
      .filter((m): m is number => typeof m === 'number');
    return marks.length ? Math.min(...marks) : null;
  } catch {
    return null;
  }
}
