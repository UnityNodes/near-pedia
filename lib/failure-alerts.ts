import type Database from 'better-sqlite3';
import { recentFailures } from './failure-events';
import { SITE } from './site.config';

export const SELF_SOURCE = 'check-failures';
export const EVENT_WINDOW_MS = 60 * 60_000;
export const RECOVER_WINDOW_MS = 6 * 3_600_000;
export const STREAK_MIN_MS = 10 * 60_000;
export const FREQUENT_TOLERANCE_S = 6 * 3600;
export const FREQUENT_MIN_RUNS = 2;
export const DEGRADED_MIN_EVENTS = 3;
export const REMIND_AFTER_MS = 24 * 3_600_000;
export const MESSAGE_MAX_BYTES = 1800;
export const DIGEST_HOUR_UTC = 6;
const DIGEST_MAX_LINES = 10;
const REASON_MAX = 140;
const STATE_KEY = 'failure-alerts';
const DIGEST_KEY = 'caller-digest';

export interface OpenFailure {
  key: string;
  label: string;
  status: string;
  reason: string;
  since: string | null;
}

export interface AlertState {
  open: Record<string, string>;
  pagedAt: number;
}

export interface AlertDecision {
  message: string | null;
  next: AlertState;
  keys: string[];
  reminder: boolean;
}

export interface PagedMessage {
  refs: string[];
  keys: string[];
  reminder: boolean;
  at: number;
}

function oneLine(text: string | null | undefined): string {
  const line = (text ?? '').split(/\s;\s|\n/)[0].replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return line.length > REASON_MAX ? `${line.slice(0, REASON_MAX - 3)}...` : line;
}

function bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

export function openFailures(
  db: Database.Database,
  scheduled: ReadonlyMap<string, number>,
  now = Date.now(),
  alreadyOpen: ReadonlySet<string> = new Set(),
): OpenFailure[] {
  const out: OpenFailure[] = [];
  const latest = db.prepare(`
    SELECT s.source, s.status, s.error
    FROM sync_log s JOIN (SELECT source, MAX(id) AS id FROM sync_log GROUP BY source) m ON m.id = s.id
    ORDER BY s.source
  `).all() as { source: string; status: string; error: string | null }[];
  const streak = db.prepare(`
    SELECT MIN(ran_at) AS since, COUNT(*) AS runs FROM sync_log
    WHERE source = ? AND id > COALESCE((SELECT MAX(id) FROM sync_log WHERE source = ? AND status = 'success'), 0)
  `);
  for (const r of latest) {
    const tolerance = scheduled.get(r.source);
    if (r.status === 'success' || r.source === SELF_SOURCE || tolerance === undefined) continue;
    const key = `source:${r.source}`;
    const row = streak.get(r.source, r.source) as { since: string | null; runs: number } | undefined;
    const since = row?.since ?? null;
    const startedAt = since ? Date.parse(since) : NaN;
    const frequent = tolerance <= FREQUENT_TOLERANCE_S;
    const settled = alreadyOpen.has(key)
      || (frequent ? (row?.runs ?? 0) >= FREQUENT_MIN_RUNS : !Number.isFinite(startedAt) || now - startedAt >= STREAK_MIN_MS);
    if (!settled) continue;
    out.push({ key, label: r.source, status: r.status, reason: oneLine(r.error), since });
  }
  for (const e of recentFailures(db, now - RECOVER_WINDOW_MS)) {
    const key = `${e.kind}:${e.surface}`;
    const held = alreadyOpen.has(key);
    if (!held) {
      if (e.lastAt < now - EVENT_WINDOW_MS) continue;
      if (e.kind === 'degraded' && e.count < DEGRADED_MIN_EVENTS && e.lastAt - e.firstAt < STREAK_MIN_MS) continue;
    }
    out.push({
      key,
      label: `${e.surface} (${e.kind === 'failed' ? 'calls failing' : 'running degraded'})`,
      status: e.kind,
      reason: `${e.count} event(s), latest: ${oneLine(e.detail)}`,
      since: new Date(e.firstAt).toISOString(),
    });
  }
  return out;
}

function clock(iso: string | null, now: number): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const hm = t.toISOString().slice(11, 16);
  return now - t.getTime() < 20 * 3_600_000 ? ` (since ${hm} UTC)` : ` (since ${t.toISOString().slice(5, 10)} ${hm} UTC)`;
}

function compose(head: string, items: OpenFailure[], tail: string[], now: number): string {
  const fixed = [head, ...tail].join('\n');
  const lines: string[] = [];
  let used = bytes(fixed) + 40;
  for (let i = 0; i < items.length; i++) {
    const f = items[i];
    const line = `- ${f.label}: ${f.status}${f.reason ? `: ${f.reason}` : ''}${clock(f.since, now)}`;
    if (used + bytes(line) + 1 > MESSAGE_MAX_BYTES) {
      lines.push(`- and ${items.length - i} more`);
      break;
    }
    lines.push(line);
    used += bytes(line) + 1;
  }
  return [head, ...lines, ...tail].join('\n');
}

function names(labels: string[], budget = 600): string {
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < labels.length; i++) {
    if (used + labels[i].length + 2 > budget) return `${out.join(', ')} and ${labels.length - i} more`;
    out.push(labels[i]);
    used += labels[i].length + 2;
  }
  return out.join(', ');
}

export function decide(prev: AlertState | null, open: OpenFailure[], now: number, statusUrl: string): AlertDecision {
  const before = prev?.open ?? {};
  const current: Record<string, string> = Object.fromEntries(open.map(f => [f.key, f.status]));
  const added = open.filter(f => before[f.key] !== f.status);
  const still = open.filter(f => before[f.key] === f.status);
  const details = `Details: ${statusUrl}`;

  if (added.length > 0) {
    const tail = still.length > 0 ? [`Still open: ${names(still.map(f => f.label))}`, details] : [details];
    return {
      message: compose(`${SITE.name}: ${added.length} new failure(s)`, added, tail, now),
      next: { open: current, pagedAt: now },
      keys: added.map(f => f.key),
      reminder: false,
    };
  }
  if (open.length > 0 && now - (prev?.pagedAt ?? 0) >= REMIND_AFTER_MS) {
    return {
      message: compose(`${SITE.name}: ${open.length} failure(s) still open`, open, [details], now),
      next: { open: current, pagedAt: now },
      keys: open.map(f => f.key),
      reminder: true,
    };
  }
  return { message: null, next: { open: current, pagedAt: prev?.pagedAt ?? 0 }, keys: [], reminder: false };
}

export function messagesToRemove(messages: PagedMessage[], open: ReadonlySet<string>, newReminder: boolean): PagedMessage[] {
  return messages.filter(m => m.keys.every(k => !open.has(k)) || (newReminder && m.reminder));
}

export function callerDigest(db: Database.Database, now: number, lastSentDay: string | null): { message: string | null; day: string } {
  const day = new Date(now).toISOString().slice(0, 10);
  if (lastSentDay === day || new Date(now).getUTCHours() < DIGEST_HOUR_UTC) return { message: null, day: lastSentDay ?? '' };
  const rows = recentFailures(db, now - 24 * 3_600_000, ['rejected']);
  if (rows.length === 0) return { message: null, day };
  const total = rows.reduce((n, r) => n + r.count, 0);
  const head = `${SITE.name} daily: ${total} call(s) refused as the caller's mistake in the last 24h`;
  const foot = 'Each repeated one is a tool contract to make easier, not a failure on our side.';
  const lines: string[] = [];
  let used = bytes(head) + bytes(foot) + 40;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const line = `- ${r.surface}: ${r.count}x from ${r.callers} caller(s), latest: ${oneLine(r.detail)}`;
    if (i >= DIGEST_MAX_LINES || used + bytes(line) + 1 > MESSAGE_MAX_BYTES) {
      lines.push(`- and ${rows.length - i} more`);
      break;
    }
    lines.push(line);
    used += bytes(line) + 1;
  }
  return { message: [head, ...lines, foot].join('\n'), day };
}

const MESSAGES_KEY = 'failure-messages';
const DIGEST_MESSAGES_KEY = 'digest-messages';

function loadPaged(db: Database.Database, key: string): PagedMessage[] {
  const value = readKey(db, key);
  if (value === null) return [];
  try {
    const parsed = JSON.parse(value) as PagedMessage[];
    return Array.isArray(parsed) ? parsed.filter(m => Array.isArray(m?.refs) && Array.isArray(m?.keys)) : [];
  } catch {
    return [];
  }
}

export function loadMessages(db: Database.Database): PagedMessage[] {
  return loadPaged(db, MESSAGES_KEY);
}

export function saveMessages(db: Database.Database, messages: PagedMessage[], now = Date.now()): void {
  writeKey(db, MESSAGES_KEY, JSON.stringify(messages), now);
}

export function loadDigestMessages(db: Database.Database): PagedMessage[] {
  return loadPaged(db, DIGEST_MESSAGES_KEY);
}

export function saveDigestMessages(db: Database.Database, messages: PagedMessage[], now = Date.now()): void {
  writeKey(db, DIGEST_MESSAGES_KEY, JSON.stringify(messages), now);
}

function readKey(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM alert_state WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function writeKey(db: Database.Database, key: string, value: string, now: number): void {
  db.prepare(`
    INSERT INTO alert_state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, new Date(now).toISOString());
}

export function loadState(db: Database.Database): AlertState | null {
  const value = readKey(db, STATE_KEY);
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as Partial<AlertState>;
    return { open: parsed.open ?? {}, pagedAt: Number(parsed.pagedAt) || 0 };
  } catch {
    return null;
  }
}

export function saveState(db: Database.Database, state: AlertState, now = Date.now()): void {
  writeKey(db, STATE_KEY, JSON.stringify(state), now);
}

export function loadDigestDay(db: Database.Database): string | null {
  return readKey(db, DIGEST_KEY);
}

export function saveDigestDay(db: Database.Database, day: string, now = Date.now()): void {
  writeKey(db, DIGEST_KEY, day, now);
}
