import type Database from 'better-sqlite3';

export type FailureKind = 'failed' | 'degraded' | 'rejected';

export interface FailureEvent {
  surface: string;
  kind: FailureKind;
  count: number;
  firstAt: number;
  lastAt: number;
  callers: number;
  detail: string | null;
}

const DETAIL_MAX = 300;

const CLIENT_ERROR = /^(MCP error -326(00|01|02):|Input validation error:|Tool \S+ not found\b)/;

const PROVIDER_FAULT_STATUS = new Set([401, 403, 408, 409, 429]);

export function isCallerMistake(text: string): boolean {
  return CLIENT_ERROR.test(text.trim());
}

export function isProviderFault(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status !== 'number') return true;
  return status >= 500 || PROVIDER_FAULT_STATUS.has(status);
}

export function recordFailure(
  db: Database.Database | null,
  surface: string,
  kind: FailureKind,
  detail: string,
  now = Date.now(),
  caller: string | null = null,
): void {
  if (!db) return;
  try {
    db.prepare('INSERT INTO failure_events (at, surface, kind, detail, caller) VALUES (?, ?, ?, ?, ?)')
      .run(now, surface, kind, detail.replace(/\s+/g, ' ').trim().slice(0, DETAIL_MAX), caller);
  } catch {
    return;
  }
}

export function recentFailures(db: Database.Database, sinceMs: number, kinds: readonly FailureKind[] = ['failed', 'degraded']): FailureEvent[] {
  const placeholders = kinds.map(() => '?').join(',');
  return db.prepare(`
    SELECT surface, kind, COUNT(*) AS count, MIN(at) AS firstAt, MAX(at) AS lastAt,
           COUNT(DISTINCT caller) AS callers,
           (SELECT f2.detail FROM failure_events f2
             WHERE f2.surface = f.surface AND f2.kind = f.kind AND f2.at >= ?
             ORDER BY f2.at DESC, f2.id DESC LIMIT 1) AS detail
    FROM failure_events f
    WHERE at >= ? AND kind IN (${placeholders})
    GROUP BY surface, kind
    ORDER BY count DESC, surface, kind
  `).all(sinceMs, sinceMs, ...kinds) as FailureEvent[];
}
