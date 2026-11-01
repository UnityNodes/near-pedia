// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  RETENTION, ROLLUPS, SYNC_LOG_KEEP_PER_SOURCE,
  ensureRollupSchema, rollup, rollupSince,
} from '@/lib/log-retention';

/**
 * The one property that matters: pruning changes how far back the DETAIL
 * goes, and changes no published lifetime figure at all.
 *
 * nearpedia's schema has no page_visits/api_requests, and mcp_calls is
 * keyed on an ISO `ts` column with no session_id. This test exists because
 * it once caught a real omission: two counters were wired for eleven metrics
 * and two were missed, and nothing else would have noticed until the pruner
 * first had something to take. `every rollup metric a reader needs is defined` below
 * is the test that would have caught it.
 */

let db: Database.Database;
const now = Date.now();
const DAY = 86_400_000;
const old = (d: number) => now - d * DAY;
const oldIso = (d: number) => new Date(old(d)).toISOString();

/** The pruner's logic (scripts/prune-logs.ts), against an injected database. */
function prune(database: Database.Database): number {
  ensureRollupSchema(database);
  let deleted = 0;
  for (const p of RETENTION) {
    const cutoffMs = now - p.days * DAY;
    const where = p.timeKind === 'epoch_ms'
      ? `${p.timeColumn} < ${cutoffMs}`
      : `${p.timeColumn} < '${new Date(cutoffMs).toISOString()}'`;
    let doomed = 0;
    try {
      doomed = (database.prepare(`SELECT COUNT(*) c FROM "${p.table}" WHERE ${where}`).get() as { c: number }).c;
    } catch { continue; }
    if (!doomed) continue;
    const oldest = (database.prepare(`SELECT MIN(${p.timeColumn}) t FROM "${p.table}" WHERE ${where}`).get() as { t: number | string | null }).t;
    const oldestMs = typeof oldest === 'number' ? oldest : oldest ? Date.parse(String(oldest)) : null;
    for (const m of ROLLUPS[p.table] ?? []) {
      const v = (database.prepare(m.sql(where)).get() as { v: number }).v ?? 0;
      database.prepare(`
        INSERT INTO log_rollup (table_name, metric, value, since_ms, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(table_name, metric) DO UPDATE SET
          value = value + excluded.value,
          since_ms = MIN(COALESCE(since_ms, excluded.since_ms), COALESCE(excluded.since_ms, since_ms)),
          updated_at = excluded.updated_at
      `).run(p.table, m.metric, v, oldestMs, new Date(now).toISOString());
    }
    database.prepare(`DELETE FROM "${p.table}" WHERE ${where}`).run();
    deleted += doomed;
  }
  return deleted;
}

/**
 * Every lifetime figure app/api/metrics/route.ts publishes, computed the
 * same way it does: live rows matching the metric's own predicate, plus
 * whatever the pruner has rolled up for it.
 */
function published(database: Database.Database) {
  const out: Record<string, number> = {};
  for (const [table, metrics] of Object.entries(ROLLUPS)) {
    for (const m of metrics) {
      // ROLLUPS' sql() takes a WHERE fragment for the doomed rows; '1=1'
      // asks for every live row instead, matching /api/metrics' own
      // unbounded safeCount() queries.
      const live = (database.prepare(m.sql('1=1')).get() as { v: number }).v ?? 0;
      out[`${table}.${m.metric}`] = live + rollup(table, m.metric, database);
    }
  }
  return out;
}

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE mcp_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, method TEXT, tool TEXT, source TEXT, status TEXT, duration_ms INTEGER);
    CREATE TABLE search_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER, query TEXT, result_count INTEGER);
    CREATE TABLE csp_violation_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER, violated_directive TEXT);
    CREATE TABLE sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, status TEXT, items_synced INTEGER, ran_at TEXT);
  `);

  // Half the rows sit past the retention window, half inside it, so a prune
  // has something to take and something to leave.
  const mcp = db.prepare('INSERT INTO mcp_calls (ts, method, tool, source, status, duration_ms) VALUES (?,?,?,?,?,?)');
  for (const d of [400, 1]) {
    for (let i = 0; i < 5; i++) mcp.run(oldIso(d), 'tools/call', 'search', 'claude', 'ok', 10);
    mcp.run(oldIso(d), 'tools/call', 'search', 'curl', 'error', 5);
  }

  for (const d of [400, 1]) {
    db.prepare('INSERT INTO search_log (timestamp, query, result_count) VALUES (?,?,?)').run(old(d), 'test', 3);
    db.prepare('INSERT INTO csp_violation_log (timestamp, violated_directive) VALUES (?,?)').run(old(d), 'script-src');
  }
});

afterEach(() => db?.close());

describe('pruning log tables', () => {
  it('changes no published lifetime figure', () => {
    const before = published(db);
    const deleted = prune(db);
    expect(deleted).toBeGreaterThan(0);
    expect(published(db)).toEqual(before);
  });

  it('really did delete the old rows', () => {
    const liveBefore = (db.prepare('SELECT COUNT(*) c FROM mcp_calls').get() as { c: number }).c;
    prune(db);
    const liveAfter = (db.prepare('SELECT COUNT(*) c FROM mcp_calls').get() as { c: number }).c;
    // Without this the test above would pass on a pruner that did nothing.
    expect(liveAfter).toBeLessThan(liveBefore);
    expect((db.prepare(`SELECT COUNT(*) c FROM mcp_calls WHERE ts < ?`).get(new Date(now - 180 * DAY).toISOString()) as { c: number }).c).toBe(0);
  });

  it('is idempotent', () => {
    prune(db);
    const after = published(db);
    expect(prune(db)).toBe(0);
    expect(published(db)).toEqual(after);
  });

  it('keeps the earliest recorded date recoverable across the delete', () => {
    const earliestIso = (db.prepare('SELECT MIN(ts) t FROM mcp_calls').get() as { t: string }).t;
    prune(db);
    const liveIso = (db.prepare('SELECT MIN(ts) t FROM mcp_calls').get() as { t: string | null }).t;
    const liveMs = liveIso ? Date.parse(liveIso) : Infinity;
    const prunedMs = rollupSince(['mcp_calls'], db) ?? Infinity;
    expect(Math.min(liveMs, prunedMs)).toBe(Date.parse(earliestIso));
  });

  it('every rollup metric a reader needs is defined', () => {
    // A metric read but never written is silently zero, which is how a
    // counter halves without anyone noticing.
    prune(db);
    for (const [table, metrics] of Object.entries(ROLLUPS)) {
      for (const m of metrics) {
        expect(
          db.prepare('SELECT COUNT(*) c FROM log_rollup WHERE table_name=? AND metric=?').get(table, m.metric),
          `${table}.${m.metric} was never written by the pruner`,
        ).toEqual({ c: 1 });
      }
    }
    expect(rollup('mcp_calls', 'total', db)).toBeGreaterThan(0);
  });
});

describe('sync_log cap', () => {
  it('drops excess successes and keeps every failure', () => {
    const ins = db.prepare('INSERT INTO sync_log (source, status, ran_at) VALUES (?,?,?)');
    for (let i = 0; i < SYNC_LOG_KEEP_PER_SOURCE + 500; i++) {
      ins.run('github-releases', 'success', new Date(now - i * 60_000).toISOString());
    }
    for (let i = 0; i < 7; i++) ins.run('github-releases', 'failed', oldIso(300 + i));

    db.prepare(`
      DELETE FROM sync_log
       WHERE source = ? AND status = 'success' AND id NOT IN (
         SELECT id FROM sync_log WHERE source = ? AND status = 'success'
         ORDER BY ran_at DESC LIMIT ?
       )
    `).run('github-releases', 'github-releases', SYNC_LOG_KEEP_PER_SOURCE);

    expect((db.prepare("SELECT COUNT(*) c FROM sync_log WHERE status='success'").get() as { c: number }).c)
      .toBe(SYNC_LOG_KEEP_PER_SOURCE);
    // A failure from months ago is the evidence that a problem is old.
    expect((db.prepare("SELECT COUNT(*) c FROM sync_log WHERE status='failed'").get() as { c: number }).c).toBe(7);
  });
});
