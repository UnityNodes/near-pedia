/**
 * Reading the deprecations table: find what a name refers to, and render an
 * entry with its evidence for an agent or as JSON.
 */

import type Database from 'better-sqlite3';
import type { EntryKind, Matchers, Status, Strength } from './deprecation-types';

export interface DeprecationRow {
  id: string;
  title: string;
  kind: EntryKind;
  status: Status;
  strength: Strength;
  summary: string;
  replacement: string | null;
  replacement_url: string | null;
  since: string | null;
  effective: string | null;
  matchers: Matchers;
  subjects: string[];
  origin: 'seed' | 'signal';
  stale: boolean;
  contested: boolean;
  built_at: string;
}

export interface EvidenceRow {
  signal: string;
  strength: Strength;
  source_url: string;
  quote: string | null;
  upstream_date: string | null;
  supports: boolean;
  verified: boolean | null;
  checked: string | null;
  expired: boolean;
}

export interface DeprecationMatch extends DeprecationRow {
  /**
   * `exact`: the name is one of the entry's matchers, subjects or its id.
   * `replacement`: the name is what the entry recommends instead, so the
   * thing asked about is the live successor. `text`: it only appears in the
   * title or summary.
   */
  match: 'exact' | 'replacement' | 'text';
  evidence: EvidenceRow[];
}

interface RawRow extends Omit<DeprecationRow, 'matchers' | 'subjects' | 'stale' | 'contested'> { matchers: string; subjects: string; stale: number; contested: number }

function parse(r: RawRow): DeprecationRow {
  return { ...r, matchers: JSON.parse(r.matchers) as Matchers, subjects: JSON.parse(r.subjects) as string[], stale: r.stale === 1, contested: r.contested === 1 };
}

/** Curated entries first: with a small limit they are the ones worth keeping. */
export function allDeprecations(db: Database.Database): DeprecationRow[] {
  return (db.prepare("SELECT * FROM deprecations ORDER BY CASE origin WHEN 'seed' THEN 0 ELSE 1 END, id").all() as RawRow[]).map(parse);
}

export function getDeprecation(db: Database.Database, id: string): DeprecationRow | null {
  const row = db.prepare('SELECT * FROM deprecations WHERE id = ?').get(id) as RawRow | undefined;
  return row ? parse(row) : null;
}

export function evidenceOf(db: Database.Database, id: string): EvidenceRow[] {
  return (db.prepare(`SELECT signal, strength, source_url, quote, upstream_date, supports, verified, checked, expired FROM deprecation_evidence
      WHERE deprecation_id = ? ORDER BY supports DESC, CASE strength WHEN 'strong' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, upstream_date DESC`).all(id) as
    Array<Omit<EvidenceRow, 'supports' | 'verified' | 'expired'> & { supports: number; verified: number | null; expired: number }>)
    .map((e) => ({ ...e, supports: e.supports === 1, verified: e.verified === null ? null : e.verified === 1, expired: e.expired === 1 }));
}

/** Every exact name an entry answers to, lower-cased. */
function namesOf(d: DeprecationRow): Set<string> {
  const m = d.matchers;
  const names = [d.id, ...d.subjects, ...d.subjects.map((s) => s.slice(s.indexOf(':') + 1)),
    ...(m.npm ?? []), ...(m.crates ?? []), ...(m.imports ?? []), ...(m.identifiers ?? []), ...(m.rpc ?? []), ...(m.urls ?? []), ...(m.config ?? [])];
  return new Set(names.map((n) => n.toLowerCase()));
}

/**
 * Normalise what an agent passes: a GitHub URL becomes owner/repo, a version
 * suffix is dropped (`near-sdk-js@2.0.0`), a URL is reduced to its host for
 * the url matchers.
 */
export function queryForms(raw: string): string[] {
  const q = raw.trim().toLowerCase();
  if (!q) return [];
  const forms = new Set([q]);
  const gh = q.match(/github\.com\/([\w.-]+\/[\w.-]+)/);
  if (gh) forms.add(gh[1].replace(/\.git$/, ''));
  const versioned = q.match(/^(@?[^@\s]+)@[\w.^~<>=*-]+$/);
  if (versioned) forms.add(versioned[1]);
  try {
    // Any scheme: s3://near-lake-data-mainnet/… names the Lake bucket as its host.
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(q)) forms.add(new URL(q).hostname);
  } catch { /* not a URL */ }
  return [...forms];
}

/** A package or identifier, not an English word: "near" matched "NEAR Public Lakehouse". */
function looksLikeAName(q: string): boolean {
  return q.length >= 6 || /[-_/@.]/.test(q);
}

/** `near-api-js` inside "near-api-js 7.x", but not inside "@near-js/near-api-js-extra" or a longer URL path. */
function asWholeName(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w@/-])${escaped}($|[^\\w/-])`);
}

export function findDeprecations(db: Database.Database, raw: string, limit = 5): DeprecationMatch[] {
  const forms = queryForms(raw);
  if (forms.length === 0) return [];
  const all = allDeprecations(db);
  const exact = all.filter((d) => {
    const names = namesOf(d);
    return forms.some((f) => names.has(f));
  });
  // Asked about near-api-js, the text fallback found the @near-js/* entry,
  // whose summary names near-api-js as the successor: an answer that read as
  // "near-api-js is deprecated". A name that is an entry's replacement is
  // reported as that. Only the replacement's name is searched, not its URL:
  // every docs.near.org link made "near" a replacement of five entries.
  const replacing = exact.length ? [] : all.filter((d) => {
    const rep = (d.replacement ?? '').toLowerCase();
    return forms.some((f) => looksLikeAName(f) && asWholeName(f).test(rep));
  });
  const named = new Set([...exact, ...replacing].map((d) => d.id));
  const text = exact.length || replacing.length ? [] : all.filter((d) => !named.has(d.id) && forms.some((f) => f.length >= 4 && `${d.title} ${d.summary}`.toLowerCase().includes(f)));
  return [
    ...exact.map((d) => ({ ...d, match: 'exact' as const })),
    ...replacing.map((d) => ({ ...d, match: 'replacement' as const })),
    ...text.map((d) => ({ ...d, match: 'text' as const })),
  ]
    .slice(0, limit)
    .map((d) => ({ ...d, evidence: evidenceOf(db, d.id) }));
}

const STATUS_LABEL: Record<Status, string> = {
  removed: 'REMOVED',
  deprecated: 'DEPRECATED',
  superseded: 'SUPERSEDED (still supported; a successor is recommended)',
  changed: 'BEHAVIOUR CHANGED',
  possibly_deprecated: 'POSSIBLY DEPRECATED',
};

function evidenceLine(e: EvidenceRow, fence: (s: string) => string): string {
  const when = e.upstream_date ? ` (${e.upstream_date})` : '';
  const how = e.verified === false ? 'QUOTE NO LONGER AT SOURCE'
    : e.expired ? `hand check of ${e.checked} has expired, not counted`
      : e.checked ? `checked by hand ${e.checked}`
        : e.verified === true ? 'confirmed in synced data' : 'unchecked';
  const said = e.quote ? ` ${fence(`"${e.quote}"`)}` : e.signal === 'repo_archived' ? ' GitHub reports the repository archived' : '';
  return `- ${e.supports ? '' : 'AGAINST: '}[${e.signal}, ${e.strength}]${said} — ${e.source_url}${when} — ${how}`;
}

/**
 * Everything of a signal entry is upstream text: its title is the first
 * backticked span of a release bullet, its replacement a README's own words.
 * All of it goes through the caller's fence, so it reaches an agent as data,
 * never as instructions. A curated entry's own fields are ours.
 */
export function renderDeprecation(d: DeprecationMatch, fence: (s: string) => string = (s) => s): string {
  const own = d.origin === 'seed' ? (s: string) => s : fence;
  const replacement = d.replacement ? `Use instead: ${own(d.replacement)}${d.replacement_url ? ` — ${own(d.replacement_url)}` : ''}` : null;
  if (d.match === 'replacement') {
    return [`## ${own(d.title)} — the name you asked about is its recommended replacement, not a deprecated thing`, replacement, own(d.summary)].filter(Boolean).join('\n');
  }
  const flags = [
    d.stale ? 'UNVERIFIED: the sources behind this entry no longer say it; treat it as a lead, not a fact' : null,
    d.contested ? 'CONTESTED: see the AGAINST evidence' : null,
  ].filter(Boolean);
  const lines = [
    `## ${own(d.title)} — ${STATUS_LABEL[d.status]}${d.stale ? '' : ` (${d.strength} evidence)`}${flags.length ? ` — ${flags.join('; ')}` : ''}`,
    own(d.summary),
  ];
  if (replacement) lines.push(replacement);
  const dates = [d.since ? `since ${d.since}` : null, d.effective ? `effective: ${own(d.effective)}` : null].filter(Boolean);
  if (dates.length) lines.push(dates.join(' | '));
  if (d.evidence.length) lines.push('Evidence:', ...d.evidence.map((e) => evidenceLine(e, fence)));
  if (d.match === 'text') lines.push('(Matched by text, not by name: check that this is the thing you asked about.)');
  return lines.join('\n');
}
