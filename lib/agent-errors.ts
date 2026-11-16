import type Database from 'better-sqlite3';

export const SWEEP_TOOLS = 5;

export interface ToolCallTally {
  tool: string;
  calls: number;
  errs: number;
}

export function sweeperRejections(db: Database.Database, sinceMs: number, minTools = SWEEP_TOOLS): Map<string, number> {
  const rows = db.prepare(`
    SELECT surface AS tool, COUNT(*) AS n
    FROM failure_events
    WHERE kind = 'rejected' AND at > @since AND caller IN (
      SELECT caller FROM failure_events
      WHERE kind = 'rejected' AND at > @since AND caller IS NOT NULL
      GROUP BY caller HAVING COUNT(DISTINCT surface) >= @minTools
    )
    GROUP BY surface
  `).all({ since: sinceMs, minTools }) as Array<{ tool: string; n: number }>;
  return new Map(rows.map(r => [r.tool, r.n]));
}

export function discountSweepers(rows: ToolCallTally[], swept: Map<string, number>): ToolCallTally[] {
  return rows.map(r => {
    const n = Math.min(swept.get(r.tool) ?? 0, r.errs);
    return { tool: r.tool, calls: r.calls - n, errs: r.errs - n };
  });
}
