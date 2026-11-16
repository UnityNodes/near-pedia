import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { discountSweepers, sweeperRejections } from '@/lib/agent-errors';

function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE failure_events (id INTEGER PRIMARY KEY, at INTEGER, surface TEXT, kind TEXT, detail TEXT, caller TEXT)`);
  return d;
}

const NOW = 1_800_000_000_000;

function reject(d: Database.Database, surface: string, caller: string | null, at = NOW) {
  d.prepare(`INSERT INTO failure_events (at, surface, kind, detail, caller) VALUES (?, ?, 'rejected', 'x', ?)`).run(at, surface, caller);
}

describe('sweeperRejections', () => {
  it('counts rejections only from callers rejected on five or more tools', () => {
    const d = db();
    for (const t of ['a', 'b', 'c', 'd', 'get_discussion']) reject(d, t, 'scanner');
    reject(d, 'get_discussion', 'scanner');
    reject(d, 'get_discussion', 'agent');
    reject(d, 'get_doc', 'agent');
    expect(sweeperRejections(d, NOW - 1000).get('get_discussion')).toBe(2);
    expect(sweeperRejections(d, NOW - 1000).get('get_doc')).toBeUndefined();
  });

  it('ignores rows outside the window and rows with no caller', () => {
    const d = db();
    for (const t of ['a', 'b', 'c', 'd']) reject(d, t, 'old');
    reject(d, 'e', 'old', NOW - 10_000);
    for (const t of ['a', 'b', 'c', 'd', 'e']) reject(d, t, null);
    expect(sweeperRejections(d, NOW - 1000).size).toBe(0);
  });
});

describe('discountSweepers', () => {
  it('takes sweeper rejections off both errors and calls, never below zero', () => {
    const rows = [
      { tool: 'get_discussion', calls: 10, errs: 5 },
      { tool: 'search', calls: 40, errs: 1 },
    ];
    const out = discountSweepers(rows, new Map([['get_discussion', 3], ['search', 9]]));
    expect(out).toEqual([
      { tool: 'get_discussion', calls: 7, errs: 2 },
      { tool: 'search', calls: 39, errs: 0 },
    ]);
  });
});
