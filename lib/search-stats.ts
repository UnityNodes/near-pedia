import { getDb } from './db';

const MAX_LEN = 200;

/** Truncates query string before storage to keep search_log bounded. */
function clean(q: string): string {
  const t = q.trim().slice(0, MAX_LEN);
  // Collapse runs of whitespace so "foo   bar" and "foo bar" group.
  return t.replace(/\s+/g, ' ');
}

export function logSearch(query: string, resultCount: number, agentClass: string | null = null): void {
  const q = clean(query);
  if (!q) return;
  try {
    getDb().prepare(
      'INSERT INTO search_log (timestamp, query, result_count, agent_class) VALUES (?, ?, ?, ?)'
    ).run(Date.now(), q, resultCount, agentClass);
  } catch {
    /* analytics is best-effort; never block render */
  }
}

export interface PopularQueryRow { query: string; n: number; zero_count: number }

export function getPopularQueries(sinceMs: number, limit = 20): PopularQueryRow[] {
  try {
    return getDb().prepare(`
      SELECT
        LOWER(query) as query,
        COUNT(*) as n,
        SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) as zero_count
      FROM search_log
      WHERE timestamp >= ?
      GROUP BY LOWER(query)
      ORDER BY n DESC, query
      LIMIT ?
    `).all(sinceMs, limit) as PopularQueryRow[];
  } catch { return []; }
}

export interface ZeroResultRow { query: string; last_seen: number }

/** Distinct queries that returned 0 hits - content-gap signal. */
export function getZeroResultQueries(sinceMs: number, limit = 20): ZeroResultRow[] {
  try {
    return getDb().prepare(`
      SELECT LOWER(query) as query, MAX(timestamp) as last_seen
      FROM search_log
      WHERE timestamp >= ? AND result_count = 0
      GROUP BY LOWER(query)
      ORDER BY last_seen DESC
      LIMIT ?
    `).all(sinceMs, limit) as ZeroResultRow[];
  } catch { return []; }
}

export interface SearchStatTotals { total_24h: number; zero_24h: number; total_7d: number }

export function getSearchTotals(now: number = Date.now()): SearchStatTotals {
  const safe = (sql: string, ...params: unknown[]): number => {
    try {
      return (getDb().prepare(sql).get(...params) as { c: number }).c;
    } catch { return 0; }
  };
  const day = 86_400_000;
  return {
    total_24h: safe('SELECT COUNT(*) as c FROM search_log WHERE timestamp >= ?', now - day),
    zero_24h:  safe('SELECT COUNT(*) as c FROM search_log WHERE timestamp >= ? AND result_count = 0', now - day),
    total_7d:  safe('SELECT COUNT(*) as c FROM search_log WHERE timestamp >= ?', now - 7 * day),
  };
}
