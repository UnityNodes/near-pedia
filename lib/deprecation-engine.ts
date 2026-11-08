/**
 * Builds the deprecations table: curated seeds plus the automatic signals,
 * merged by subject, every curated quote re-checked against what the syncs
 * hold, and the strength of each entry derived from the evidence that holds.
 *
 * The table is derived. Each build replaces it whole, so an upstream change
 * (a repo unarchived, a docs quote rewritten) is reflected on the next run
 * rather than accumulating next to the old claim.
 */

import type Database from 'better-sqlite3';
import type { Entry, Evidence, Matchers, Status, Strength } from './deprecation-types';
import { STATUS_RANK, STRENGTH_RANK, strongest } from './deprecation-types';
import { SEEDS, type Seed, type SeedEvidence } from './deprecation-seeds';
import { activityEvidence, docsMarkerCandidates, dormancyEvidence, registryCandidates, releaseCandidates, repoCandidates, subjectsOf } from './deprecation-signals';
import { DOCS_ORIGIN } from './near-docs';
import { recordEvents, type ChangeEvent } from './change-events';
import { escLike } from './rank';

export interface BuiltEvidence extends Evidence {
  /** true: the quote was found at its source in our data; false: the source is synced and no longer says it; null: not re-checkable here. */
  verified: boolean | null;
  checked: string | null;
  /** A hand check older than MAX_CHECK_AGE_DAYS: kept for the record, no longer counted. */
  expired: boolean;
}

export interface BuiltEntry extends Omit<Entry, 'evidence'> {
  strength: Strength;
  /** No supporting evidence holds: every curated quote is gone from its source, or no signal backs a seed any more. */
  stale: boolean;
  /** Counter-evidence at least as strong as the best support exists; the strength shown is one level down. */
  contested: boolean;
  evidence: BuiltEvidence[];
}

/** A hand-checked source is re-checked by hand at least this often, or stops counting. */
export const MAX_CHECK_AGE_DAYS = 120;

const normalise = (s: string) => s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

/**
 * Whether a curated quote is still at its source, for the sources the syncs
 * hold. A docs page that no longer says it, or a release whose notes were
 * edited, turns the row false and the entry is reported instead of served
 * as current. A source the syncs have not filled yet (no docs pages at all,
 * no releases of that repo) is null, not false: "not synced" is not "the
 * quote was removed".
 */
export function verifyQuote(db: Database.Database, e: SeedEvidence): boolean | null {
  if (e.checked || !e.quote) return null;
  const quote = normalise(e.quote);
  if (e.source_url.startsWith(`${DOCS_ORIGIN}/`)) {
    const row = db.prepare("SELECT content_text FROM doc_pages WHERE source = 'docs' AND url = ?").get(e.source_url) as { content_text: string | null } | undefined;
    if (row) return normalise(row.content_text ?? '').includes(quote);
    const any = db.prepare("SELECT 1 FROM doc_pages WHERE source = 'docs' AND url LIKE ? ESCAPE '\\' LIMIT 1").get(`${escLike(DOCS_ORIGIN)}/%`);
    return any ? false : null;
  }
  const release = e.source_url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/tag\//);
  if (release) {
    const row = db.prepare('SELECT body FROM github_releases WHERE url = ?').get(e.source_url) as { body: string | null } | undefined;
    if (row) return row.body ? normalise(row.body).includes(quote) : false;
    const any = db.prepare('SELECT 1 FROM github_releases WHERE repo = ? LIMIT 1').get(release[1]);
    return any ? false : null;
  }
  return null;
}

function unionMatchers(a: Matchers, b: Matchers): Matchers {
  const out: Matchers = {};
  for (const k of ['npm', 'crates', 'imports', 'identifiers', 'rpc', 'urls', 'config', 'unlessNearby', 'requiresImport'] as const) {
    const v = [...new Set([...(a[k] ?? []), ...(b[k] ?? [])])];
    if (v.length) out[k] = v;
  }
  return out;
}

const evidenceKey = (e: Evidence) => `${e.signal}|${e.source_url}|${e.quote ?? ''}`;

/**
 * `curated` marks evidence a person wrote down from a source. Only that is
 * re-checked: a signal's evidence is read out of the synced rows themselves,
 * and its quote is the cleaned sentence, not the source's exact bytes.
 */
interface Draft extends Omit<Entry, 'evidence'> { evidence: Array<Evidence & { checked?: string; curated?: boolean }> }

function fromSeed(s: Seed): Draft {
  return {
    ...s,
    origin: 'seed',
    subjects: [...new Set([...s.subjects, ...subjectsOf(s.matchers)])],
    evidence: s.evidence.map((e) => ({ ...e, supports: e.supports ?? true, curated: true })),
  };
}

/**
 * Names an entry recommends instead. A package named there is the live
 * successor and must never become a matcher of the thing it replaces: a
 * README notice on the near-api-js monorepo would otherwise carry
 * near-api-js itself into the @near-js/* entry and mark it deprecated.
 */
function isReplacementName(d: Pick<Draft, 'replacement' | 'replacement_url'>, name: string): boolean {
  const text = `${d.replacement ?? ''} ${d.replacement_url ?? ''}`.toLowerCase();
  const escaped = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w@-])${escaped}($|[^\\w-])`).test(text);
}

function withoutReplacement(d: Draft, m: Matchers): Matchers {
  const keep = (xs?: string[]) => xs?.filter((n) => !isReplacementName(d, n));
  return { ...m, npm: keep(m.npm), crates: keep(m.crates), imports: keep(m.imports) };
}

/**
 * Two signals can produce the same id from different names (`Foo_Bar` and
 * `foo-bar` slug alike) without sharing a subject; the second gets a suffix
 * instead of failing the whole build on the primary key.
 */
function uniqueId(id: string, taken: Set<string>): string {
  if (!taken.has(id)) return id;
  for (let n = 2; ; n++) if (!taken.has(`${id}-${n}`)) return `${id}-${n}`;
}

/**
 * Merge every candidate that shares a subject with a draft into it. A seed
 * absorbs the signals about its subject and keeps its own wording and
 * status; two signals about one subject (an archived repo and its npm
 * package, one field removed in two releases) become one entry whose status
 * is the more severe of the two.
 */
export function mergeBySubject(seeds: readonly Seed[], candidates: readonly Entry[]): Draft[] {
  const drafts: Draft[] = seeds.map(fromSeed);
  const owner = new Map<string, Draft>();
  const ids = new Set(drafts.map((d) => d.id));
  for (const d of drafts) for (const s of d.subjects) owner.set(s, d);
  for (const c of candidates) {
    const target = c.subjects.map((s) => owner.get(s)).find(Boolean);
    if (!target) {
      const d: Draft = { ...c, id: uniqueId(c.id, ids), evidence: [...c.evidence] };
      ids.add(d.id);
      drafts.push(d);
      for (const s of d.subjects) owner.set(s, d);
      continue;
    }
    const incoming = withoutReplacement(target, target.origin === 'seed' ? { npm: c.matchers.npm, crates: c.matchers.crates } : c.matchers);
    target.matchers = unionMatchers(target.matchers, incoming);
    const subjects = c.subjects.filter((s) => !isReplacementName(target, s.slice(s.indexOf(':') + 1)));
    for (const s of subjects) if (!owner.has(s)) owner.set(s, target);
    target.subjects = [...new Set([...target.subjects, ...subjects])];
    const seen = new Set(target.evidence.map(evidenceKey));
    for (const e of c.evidence) if (!seen.has(evidenceKey(e))) target.evidence.push(e);
    if (target.origin === 'signal' && STATUS_RANK[c.status] > STATUS_RANK[target.status]) target.status = c.status;
    target.replacement ??= c.replacement;
    target.replacement_url ??= c.replacement_url;
    target.since ??= c.since;
  }
  return drafts;
}

const DOWN: Record<Strength, Strength> = { strong: 'medium', medium: 'weak', weak: 'weak' };

function isExpired(checked: string | null | undefined, now: Date): boolean {
  if (!checked) return false;
  return now.getTime() - Date.parse(checked) > MAX_CHECK_AGE_DAYS * 86_400_000;
}

export function finalize(db: Database.Database, drafts: readonly Draft[], now: Date): BuiltEntry[] {
  return drafts.map((d) => {
    const evidence: BuiltEvidence[] = d.evidence.map(({ curated, ...e }) => ({
      ...e,
      verified: curated ? verifyQuote(db, e) : true,
      checked: e.checked ?? null,
      expired: isExpired(e.checked, now),
    }));
    const counts = (e: BuiltEvidence) => e.verified !== false && !e.expired;
    // Dormancy is corroboration only: a quiet package proves nothing on its
    // own, so it never keeps an entry alive whose real evidence has gone.
    const primary = evidence.filter((e) => e.supports && counts(e));
    const best = strongest(primary.map((e) => e.strength));
    if (best && d.replacement) {
      const seen = new Set(evidence.map(evidenceKey));
      for (const e of dormancyEvidence(db, d.matchers, now)) if (!seen.has(evidenceKey(e))) evidence.push({ ...e, verified: true, checked: null, expired: false });
    }
    if (best) {
      const seen = new Set(evidence.map(evidenceKey));
      for (const e of activityEvidence(db, d.matchers, now)) if (!seen.has(evidenceKey(e))) evidence.push({ ...e, verified: true, checked: null, expired: false });
    }
    const against = strongest(evidence.filter((e) => !e.supports && counts(e)).map((e) => e.strength));
    const contested = Boolean(best && against && STRENGTH_RANK[against] >= STRENGTH_RANK[best]);
    const strength = best ? (contested ? DOWN[best] : best) : 'weak';
    const status: Status = d.origin === 'seed' ? d.status : strength === 'weak' ? 'possibly_deprecated' : d.status;
    return { ...d, strength, status, stale: best === null, contested, evidence };
  });
}

export function subjectsOfUrl(url: string): string[] {
  let u: URL;
  try { u = new URL(url.trim()); } catch { return []; }
  if (!/^https?:$/.test(u.protocol)) return [];
  const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const parts = u.pathname.split('/').filter(Boolean);
  const out: string[] = [];
  if (host === 'github.com' && parts.length === 2) out.push(`github:${parts[0]}/${parts[1].replace(/\.git$/i, '')}`);
  if (host === 'npmjs.com' && parts[0] === 'package') {
    const name = parts[1]?.startsWith('@') ? parts.slice(1, 3).join('/') : parts[1];
    const rest = parts.slice(parts[1]?.startsWith('@') ? 3 : 2);
    if (name && rest.length === 0) out.push(`npm:${decodeURIComponent(name)}`);
  }
  if (host === 'crates.io' && parts[0] === 'crates' && parts.length === 2) out.push(`crates:${parts[1]}`);
  const labels = host.split('.');
  for (let i = 0; i <= labels.length - 2; i++) out.push(`host:${labels.slice(i).join('.')}`);
  return out.map((k) => k.toLowerCase());
}

export interface ReplacementNode {
  id: string;
  status: Status;
  strength: Strength;
  stale: boolean;
  subjects: string[];
  replacement: string | null;
  replacement_url: string | null;
}

export const isDeadEnd = (e: Pick<ReplacementNode, 'status' | 'strength' | 'stale'>): boolean =>
  !e.stale && e.strength === 'strong' && (e.status === 'deprecated' || e.status === 'removed');

export function subjectOwners<T extends ReplacementNode>(entries: readonly T[]): Map<string, T> {
  const owners = new Map<string, T>();
  for (const e of entries) for (const s of e.subjects) if (!owners.has(s.toLowerCase())) owners.set(s.toLowerCase(), e);
  return owners;
}

export function ownerOfUrl<T extends ReplacementNode>(owners: Map<string, T>, url: string): T | null {
  for (const key of subjectsOfUrl(url)) {
    const e = owners.get(key);
    if (e) return e;
  }
  return null;
}

export function replacementChain<T extends ReplacementNode>(entry: T, owners: Map<string, T>): { chain: T[]; cycle: boolean } {
  const chain: T[] = [];
  const visited = new Set([entry.id]);
  let cur: T = entry;
  while (cur.replacement_url) {
    const next = ownerOfUrl(owners, cur.replacement_url);
    if (!next || next.id === cur.id) break;
    if (visited.has(next.id)) return { chain, cycle: true };
    if (!isDeadEnd(next)) break;
    chain.push(next);
    visited.add(next.id);
    cur = next;
  }
  return { chain, cycle: false };
}

function deadWord(e: BuiltEntry): string {
  return e.evidence.some((v) => v.signal === 'repo_archived' && v.supports) ? 'archived' : e.status;
}

function missingRepoNote(db: Database.Database, url: string, who: string): string | null {
  const key = subjectsOfUrl(url).find((k) => k.startsWith('github:'));
  if (!key) return null;
  const fullName = key.slice('github:'.length);
  const org = fullName.split('/')[0];
  const synced = db.prepare('SELECT 1 FROM github_repos WHERE lower(org) = ? LIMIT 1').get(org);
  const present = db.prepare('SELECT 1 FROM github_repos WHERE lower(full_name) = ? LIMIT 1').get(fullName);
  if (!synced || present) return null;
  return `${who} suggested replacement ${url} is not among the ${org} repositories on GitHub any more: it was renamed or removed.`;
}

export function resolveReplacements(db: Database.Database, entries: readonly BuiltEntry[]): BuiltEntry[] {
  const owners = subjectOwners(entries);
  return entries.map((e) => {
    if (!e.replacement_url) return e;
    const who = e.origin === 'signal' ? "The README's" : 'The';
    const { chain, cycle } = replacementChain(e, owners);
    if (!chain.length) {
      const note = ownerOfUrl(owners, e.replacement_url) ? null : missingRepoNote(db, e.replacement_url, who);
      return note ? { ...e, summary: `${e.summary} ${note}` } : e;
    }
    const first = chain[0];
    const last = chain[chain.length - 1];
    const suggested = e.replacement ?? e.replacement_url;
    const said = `${who} suggested replacement ${suggested} is itself ${deadWord(first)} (see check_deprecation("${first.id}")).`;
    if (!cycle && last.replacement_url) {
      return { ...e, replacement: last.replacement, replacement_url: last.replacement_url, summary: `${e.summary} ${said} Its own recommendation is used instead.` };
    }
    return { ...e, replacement: null, replacement_url: null, summary: `${e.summary} ${said}` };
  });
}

/** The synced tables the engine reads; a build over an empty one would mark half the seeds stale and overwrite a good table. */
export const SOURCE_TABLES = ['github_repos', 'packages', 'github_releases', 'doc_pages'] as const;

export function emptySources(db: Database.Database): string[] {
  return SOURCE_TABLES.filter((t) => !(db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get()));
}

export function buildEntries(db: Database.Database, now: Date = new Date()): BuiltEntry[] {
  const candidates = [
    ...docsMarkerCandidates(db),
    ...releaseCandidates(db, now),
    ...repoCandidates(db),
    ...registryCandidates(db),
  ];
  return resolveReplacements(db, finalize(db, mergeBySubject(SEEDS, candidates), now));
}

export interface WriteResult { entries: number; stale: string[]; added: number }

/** Replace the derived tables with this build, and log entries that are new since the last one. */
export function writeEntries(db: Database.Database, entries: readonly BuiltEntry[], now: string): WriteResult {
  const before = new Set((db.prepare('SELECT id FROM deprecations').all() as { id: string }[]).map((r) => r.id));
  const events: ChangeEvent[] = before.size === 0 ? [] : entries.filter((e) => !before.has(e.id) && !e.stale).map((e) => ({
    kind: 'deprecation_added',
    subject: `deprecation:${e.id}`,
    title: `New deprecation: ${e.title}`,
    detail: { status: e.status, strength: e.strength },
    source_url: e.evidence[0]?.source_url ?? null,
    key: e.id,
  }));
  let added = 0;
  db.transaction(() => {
    db.prepare('DELETE FROM deprecation_evidence').run();
    db.prepare('DELETE FROM deprecations').run();
    const ins = db.prepare(`INSERT INTO deprecations (id, title, kind, status, strength, summary, replacement, replacement_url, since, effective,
        effective_protocol, matchers, subjects, origin, stale, contested, built_at) VALUES (@id, @title, @kind, @status, @strength, @summary, @replacement,
        @replacement_url, @since, @effective, @effective_protocol, @matchers, @subjects, @origin, @stale, @contested, @built_at)`);
    const insE = db.prepare(`INSERT OR IGNORE INTO deprecation_evidence (deprecation_id, signal, strength, source_url, quote, upstream_date, supports,
        verified, checked, expired) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const e of entries) {
      ins.run({
        id: e.id, title: e.title, kind: e.kind, status: e.status, strength: e.strength, summary: e.summary,
        replacement: e.replacement, replacement_url: e.replacement_url, since: e.since, effective: e.effective, effective_protocol: e.effective_protocol ?? null,
        matchers: JSON.stringify(e.matchers), subjects: JSON.stringify(e.subjects), origin: e.origin, stale: e.stale ? 1 : 0, contested: e.contested ? 1 : 0, built_at: now,
      });
      for (const v of e.evidence) {
        insE.run(e.id, v.signal, v.strength, v.source_url, v.quote, v.upstream_date, v.supports ? 1 : 0, v.verified === null ? null : v.verified ? 1 : 0, v.checked, v.expired ? 1 : 0);
      }
    }
    added = recordEvents(db, events, now);
  })();
  return { entries: entries.length, stale: entries.filter((e) => e.stale).map((e) => e.id), added };
}
