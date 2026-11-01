// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { SITE } from '@/lib/site.config';
import Database from 'better-sqlite3';
import { initSchema } from '@/lib/db';
import {
  callerDigest, decide, loadDigestDay, loadDigestMessages, loadMessages, loadState, messagesToRemove, openFailures, saveDigestDay, saveDigestMessages, saveMessages, saveState,
  EVENT_WINDOW_MS, FREQUENT_TOLERANCE_S, MESSAGE_MAX_BYTES, RECOVER_WINDOW_MS, REMIND_AFTER_MS, SELF_SOURCE, STREAK_MIN_MS,
} from '@/lib/failure-alerts';
import { isCallerMistake, isProviderFault, recentFailures, recordFailure } from '@/lib/failure-events';

const NOW = Date.parse('2026-10-20T06:00:00.000Z');
const URL = `${SITE.url}/status`;
type Db = Database.Database;

function migratedDb(): Db {
  const db = new Database(':memory:');
  initSchema(db);
  const cols = db.prepare('PRAGMA table_info(sync_log)').all() as { name: string }[];
  if (!cols.some(c => c.name === 'error')) db.exec('ALTER TABLE sync_log ADD COLUMN error TEXT');
  return db;
}
const DAILY = 60 * 3600;
const MEDIUM = 6 * 3600;

function sched(entries: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(entries));
}

function logRow(db: Db, source: string, status: string, ranAt: string, error: string | null = null): void {
  db.prepare('INSERT INTO sync_log (source, status, items_synced, ran_at, error) VALUES (?, ?, 0, ?, ?)').run(source, status, ranAt, error);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

describe('openFailures: scheduled sources', () => {
  it('lists a source whose newest run failed, with the start of the failing streak', () => {
    const db = migratedDb();
    logRow(db, 'build-embeddings', 'success', '2026-10-19T18:47:43.209Z');
    logRow(db, 'build-embeddings', 'error', '2026-10-20T00:24:46.539Z', 'Error: 429 You have no credits remaining');
    logRow(db, 'build-embeddings', 'error', '2026-10-20T04:03:45.378Z', 'Error: 429 You have no credits remaining');
    const open = openFailures(db, sched({ 'build-embeddings': DAILY }), NOW);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ key: 'source:build-embeddings', status: 'error', since: '2026-10-20T00:24:46.539Z' });
    expect(open[0].reason).toContain('429');
  });

  it('counts partial as a failure and skips success, unscheduled sources and itself', () => {
    const db = migratedDb();
    logRow(db, 'check-parsed', 'partial', '2026-10-20T03:57:25.603Z', '1 field(s) disagree ; second note');
    logRow(db, 'sync-forum', 'success', '2026-10-20T05:55:00.000Z');
    logRow(db, 'check-ecosystem-twitter', 'error', '2026-10-12T03:34:14.437Z', 'x.com refused');
    logRow(db, SELF_SOURCE, 'error', '2026-10-20T05:00:00.000Z', 'crashed');
    const open = openFailures(db, sched({ 'check-parsed': DAILY, 'sync-forum': DAILY, [SELF_SOURCE]: DAILY }), NOW);
    expect(open.map(f => f.label)).toEqual(['check-parsed']);
    expect(open[0].reason).toBe('1 field(s) disagree');
  });

  it('waits out a slow source streak younger than the settle time, unless it was already paged', () => {
    const db = migratedDb();
    logRow(db, 'sync-releases', 'success', iso(NOW - 20 * 60_000));
    logRow(db, 'sync-releases', 'error', iso(NOW - STREAK_MIN_MS + 60_000), 'HTTP 502');
    const s = sched({ 'sync-releases': DAILY });
    expect(openFailures(db, s, NOW)).toEqual([]);
    expect(openFailures(db, s, NOW, new Set(['source:sync-releases']))).toHaveLength(1);
    expect(openFailures(db, s, NOW + 2 * 60_000)).toHaveLength(1);
  });

  it('pages a frequent source only after two failing runs in a row, however old the first one is', () => {
    const db = migratedDb();
    const s = sched({ 'check-embeddings': MEDIUM });
    expect(MEDIUM).toBeLessThanOrEqual(FREQUENT_TOLERANCE_S);
    logRow(db, 'check-embeddings', 'success', '2026-10-20T21:47:04.033Z');
    logRow(db, 'check-embeddings', 'error', '2026-10-20T22:02:17.362Z', 'openai FAILED in 10523ms: Request timed out.');
    expect(openFailures(db, s, Date.parse('2026-10-20T22:16:00Z'))).toEqual([]);
    logRow(db, 'check-embeddings', 'error', '2026-10-20T22:17:07.974Z', 'openai FAILED: 429 You have no credits remaining');
    expect(openFailures(db, s, Date.parse('2026-10-20T22:18:00Z')).map(f => f.key)).toEqual(['source:check-embeddings']);
  });

  it('forgets a frequent source whose second run succeeded', () => {
    const db = migratedDb();
    const s = sched({ 'check-embeddings': MEDIUM });
    logRow(db, 'check-embeddings', 'error', '2026-10-20T22:02:17.362Z', 'Request timed out.');
    logRow(db, 'check-embeddings', 'success', '2026-10-20T22:17:07.974Z');
    expect(openFailures(db, s, Date.parse('2026-10-20T22:18:00Z'))).toEqual([]);
  });

  it('a success after a failure closes the source', () => {
    const db = migratedDb();
    logRow(db, 'check-reranker', 'error', '2026-10-20T05:00:00.000Z', 'Cloudflare HTTP 429');
    logRow(db, 'check-reranker', 'success', '2026-10-20T05:15:00.000Z');
    expect(openFailures(db, sched({ 'check-reranker': MEDIUM }), NOW)).toEqual([]);
  });

  it('flattens control characters out of the reason', () => {
    const db = migratedDb();
    logRow(db, 'sync-blog', 'error', iso(NOW - 3_600_000), 'bad\u001b[31m byte\u0007 here');
    expect(openFailures(db, sched({ 'sync-blog': DAILY }), NOW)[0].reason).toBe('bad [31m byte here');
  });
});

describe('openFailures: tool events', () => {
  it('opens a failed tool on the first event, dating it from the first one', () => {
    const db = migratedDb();
    recordFailure(db, 'semantic_search', 'failed', 'semantic_search failed: 429 You have no credits remaining', NOW - 5 * 60_000);
    recordFailure(db, 'semantic_search', 'failed', 'semantic_search failed: 429 again', NOW - 60_000);
    const open = openFailures(db, new Map(), NOW);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ key: 'failed:semantic_search', since: iso(NOW - 5 * 60_000) });
    expect(open[0].reason).toContain('2 event(s)');
    expect(open[0].reason).toContain('429 again');
  });

  it('needs a run of degraded events before it opens one', () => {
    const db = migratedDb();
    recordFailure(db, 'reranker', 'degraded', 'cloudflare: over 3000ms deadline', NOW - 60_000);
    expect(openFailures(db, new Map(), NOW)).toEqual([]);
    recordFailure(db, 'reranker', 'degraded', 'cloudflare: over 3000ms deadline', NOW - 30_000);
    recordFailure(db, 'reranker', 'degraded', 'cloudflare: over 3000ms deadline', NOW - 10_000);
    expect(openFailures(db, new Map(), NOW).map(f => f.key)).toEqual(['degraded:reranker']);
  });

  it('keeps a paged event open through a quiet hour, and lets it go after the recovery window', () => {
    const db = migratedDb();
    recordFailure(db, 'get_cip_votes', 'failed', 'get_cip_votes failed: SQLITE_BUSY', NOW - EVENT_WINDOW_MS - 60_000);
    const held = new Set(['failed:get_cip_votes']);
    expect(openFailures(db, new Map(), NOW)).toEqual([]);
    expect(openFailures(db, new Map(), NOW, held)).toHaveLength(1);
    expect(openFailures(db, new Map(), NOW + RECOVER_WINDOW_MS, held)).toEqual([]);
  });

  it('never opens a caller mistake', () => {
    const db = migratedDb();
    recordFailure(db, 'get_cip', 'rejected', 'MCP error -32602: Input validation error', NOW - 60_000, 'c1');
    expect(openFailures(db, new Map(), NOW)).toEqual([]);
  });
});

describe('decide', () => {
  const embeddings = { key: 'source:build-embeddings', label: 'build-embeddings', status: 'error', reason: 'Error: 429', since: '2026-10-20T00:24:46.539Z' };
  const parsed = { key: 'source:check-parsed', label: 'check-parsed', status: 'partial', reason: '1 field', since: '2026-10-20T03:57:25.603Z' };

  it('pages every open failure on the first run and names the keys the message covers', () => {
    const d = decide(null, [embeddings, parsed], NOW, URL);
    expect(d.message).toContain(`${SITE.name}: 2 new failure(s)`);
    expect(d.message).toContain('- build-embeddings: error: Error: 429 (since 00:24 UTC)');
    expect(d.message).toContain(`Details: ${URL}`);
    expect(d.next).toEqual({ open: { 'source:build-embeddings': 'error', 'source:check-parsed': 'partial' }, pagedAt: NOW });
    expect(d.keys).toEqual(['source:build-embeddings', 'source:check-parsed']);
    expect(d.reminder).toBe(false);
  });

  it('stays quiet while the open set is unchanged, then reminds once a day', () => {
    const prev = { open: { 'source:build-embeddings': 'error' }, pagedAt: NOW - 60_000 };
    expect(decide(prev, [embeddings], NOW, URL).message).toBeNull();
    expect(decide(prev, [embeddings], NOW, URL).next.pagedAt).toBe(prev.pagedAt);
    expect(decide(prev, [embeddings], prev.pagedAt + REMIND_AFTER_MS, URL).message).toContain(`${SITE.name}: 1 failure(s) still open`);
  });

  it('pages only the newcomer and names what is still open', () => {
    const prev = { open: { 'source:build-embeddings': 'error' }, pagedAt: NOW - 60_000 };
    const d = decide(prev, [embeddings, parsed], NOW, URL);
    expect(d.message).toContain(`${SITE.name}: 1 new failure(s)`);
    expect(d.message).toContain('- check-parsed: partial');
    expect(d.message).not.toContain('- build-embeddings');
    expect(d.message).toContain('Still open: build-embeddings');
  });

  it('pages a change of status as new', () => {
    const prev = { open: { 'source:check-parsed': 'partial' }, pagedAt: NOW - 60_000 };
    expect(decide(prev, [{ ...parsed, status: 'error' }], NOW, URL).message).toContain(`${SITE.name}: 1 new failure(s)`);
  });

  it('sends nothing on recovery: the resolved alert is removed instead', () => {
    const prev = { open: { 'source:build-embeddings': 'error', 'failed:semantic_search': 'failed' }, pagedAt: NOW - 60_000 };
    const d = decide(prev, [], NOW, URL);
    expect(d.message).toBeNull();
    expect(d.next).toEqual({ open: {}, pagedAt: NOW - 60_000 });
  });

  it('marks a daily reminder as one, covering every open key', () => {
    const prev = { open: { 'source:build-embeddings': 'error' }, pagedAt: NOW - REMIND_AFTER_MS };
    const d = decide(prev, [embeddings], NOW, URL);
    expect(d.reminder).toBe(true);
    expect(d.keys).toEqual(['source:build-embeddings']);
  });

  it('fits a long list into one message and says how many it left out', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...parsed, key: `source:s${i}`, label: `s${i}`, reason: 'ж'.repeat(140) }));
    const d = decide(null, many, NOW, URL);
    expect(Buffer.byteLength(d.message ?? '', 'utf8')).toBeLessThanOrEqual(MESSAGE_MAX_BYTES);
    expect(d.message).toMatch(/- and \d+ more/);
    expect(d.message).toContain(`Details: ${URL}`);
  });
});

describe('messagesToRemove', () => {
  const page = (keys: string[], reminder = false) => ({ refs: ['discord:1'], keys, reminder, at: NOW });

  it('removes a message once none of the failures it reported is open', () => {
    const a = page(['source:check-parsed']);
    const b = page(['source:build-embeddings', 'failed:semantic_search']);
    expect(messagesToRemove([a, b], new Set(['failed:semantic_search']), false)).toEqual([a]);
    expect(messagesToRemove([a, b], new Set(), false)).toEqual([a, b]);
  });

  it('keeps a message while any failure in it is still open', () => {
    const b = page(['source:build-embeddings', 'failed:semantic_search']);
    expect(messagesToRemove([b], new Set(['source:build-embeddings']), false)).toEqual([]);
  });

  it('removes earlier reminders when a new reminder goes out', () => {
    const old = page(['source:check-parsed'], true);
    const failure = page(['source:check-parsed']);
    expect(messagesToRemove([old, failure], new Set(['source:check-parsed']), true)).toEqual([old]);
  });

  it('round-trips through alert_state and ignores a broken value', () => {
    const db = migratedDb();
    expect(loadMessages(db)).toEqual([]);
    saveMessages(db, [page(['source:a'])], NOW);
    expect(loadMessages(db)).toEqual([page(['source:a'])]);
    db.prepare("UPDATE alert_state SET value = '{broken' WHERE key = 'failure-messages'").run();
    expect(loadMessages(db)).toEqual([]);
  });
});

describe('callerDigest', () => {
  it('summarises a day of caller mistakes once, after the digest hour', () => {
    const db = migratedDb();
    for (let i = 0; i < 3; i++) recordFailure(db, 'tools/list', 'rejected', 'HTTP 406 on POST /mcp', NOW - i * 60_000, 'script-a');
    recordFailure(db, 'get_cip', 'rejected', 'MCP error -32602: Input validation error', NOW - 60_000, 'agent-b');
    const d = callerDigest(db, NOW, null);
    expect(d.day).toBe('2026-10-20');
    expect(d.message).toContain(`${SITE.name} daily: 4 call(s) refused`);
    expect(d.message).toContain('- tools/list: 3x from 1 caller(s), latest: HTTP 406 on POST /mcp');
    expect(callerDigest(db, NOW, '2026-10-20').message).toBeNull();
    expect(callerDigest(db, Date.parse('2026-10-21T05:00:00Z'), '2026-10-20').message).toBeNull();
  });

  it('sends nothing for a day without mistakes', () => {
    expect(callerDigest(migratedDb(), NOW, null).message).toBeNull();
  });
});

describe('alert state', () => {
  it('round-trips the open set and the digest day through alert_state', () => {
    const db = migratedDb();
    expect(loadState(db)).toBeNull();
    expect(loadDigestDay(db)).toBeNull();
    saveState(db, { open: { 'source:a': 'error' }, pagedAt: NOW }, NOW);
    saveState(db, { open: { 'source:b': 'partial' }, pagedAt: NOW + 1 }, NOW + 1);
    saveDigestDay(db, '2026-10-20', NOW);
    expect(loadState(db)).toEqual({ open: { 'source:b': 'partial' }, pagedAt: NOW + 1 });
    expect(loadDigestDay(db)).toBe('2026-10-20');
  });
});

describe('digest messages', () => {
  it('keeps the digest message ids apart from the failure message ids', () => {
    const db = migratedDb();
    expect(loadDigestMessages(db)).toEqual([]);
    saveDigestMessages(db, [{ refs: ['discord:1'], keys: [], reminder: false, at: NOW }], NOW);
    const failure = { refs: ['discord:2'], keys: ['source:a'], reminder: false, at: NOW };
    saveMessages(db, [failure], NOW);
    expect(loadDigestMessages(db)).toEqual([{ refs: ['discord:1'], keys: [], reminder: false, at: NOW }]);
    expect(loadMessages(db)).toEqual([failure]);
    saveDigestMessages(db, [], NOW);
    expect(loadDigestMessages(db)).toEqual([]);
    expect(loadMessages(db)).toEqual([failure]);
  });
});

describe('failure events', () => {
  it('tells a caller mistake from a server failure', () => {
    expect(isCallerMistake('MCP error -32602: Input validation error: Invalid arguments for tool get_cip')).toBe(true);
    expect(isCallerMistake('MCP error -32601: Tool nope not found')).toBe(true);
    expect(isCallerMistake('Input validation error: Invalid arguments for tool search: query: Invalid input: expected string, received number')).toBe(true);
    expect(isCallerMistake('Tool no_such_tool not found')).toBe(true);
    expect(isCallerMistake('MCP error -32603: Internal error')).toBe(false);
    expect(isCallerMistake('semantic_search failed: 429 You have no credits remaining')).toBe(false);
  });

  it('blames the provider for auth, quota, timeouts and 5xx, and the caller for a 400', () => {
    expect(isProviderFault(Object.assign(new Error('429'), { status: 429 }))).toBe(true);
    expect(isProviderFault(Object.assign(new Error('401'), { status: 401 }))).toBe(true);
    expect(isProviderFault(Object.assign(new Error('503'), { status: 503 }))).toBe(true);
    expect(isProviderFault(new Error('fetch failed'))).toBe(true);
    expect(isProviderFault(Object.assign(new Error('400 input is empty'), { status: 400 }))).toBe(false);
  });

  it('records nothing and throws nothing without a database', () => {
    expect(() => recordFailure(null, 'x', 'failed', 'y')).not.toThrow();
  });

  it('keeps the newest detail per surface and kind, flattened and capped, and counts callers', () => {
    const db = migratedDb();
    recordFailure(db, 'reranker', 'degraded', 'first', NOW - 2000, 'a');
    recordFailure(db, 'reranker', 'degraded', `second\n${'x'.repeat(400)}`, NOW - 1000, 'b');
    const [e] = recentFailures(db, NOW - 10_000);
    expect(e).toMatchObject({ surface: 'reranker', kind: 'degraded', count: 2, firstAt: NOW - 2000, lastAt: NOW - 1000, callers: 2 });
    expect(e.detail?.startsWith('second x')).toBe(true);
    expect(e.detail?.length).toBe(300);
  });
});
