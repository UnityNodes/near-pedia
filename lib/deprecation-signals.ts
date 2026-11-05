/**
 * The engine's automatic signals, read from what the syncs stored. Each
 * collector returns candidate entries; the engine merges candidates that
 * share a subject with each other and with the curated seeds.
 */

import type Database from 'better-sqlite3';
import type { Entry, EntryKind, Evidence, Matchers } from './deprecation-types';
import { extractDocsMarker, extractReleaseRemovals } from './deprecation-extract';
import { productOfTag } from './release-sources';
import { DOCS_ORIGIN } from './near-docs';
import { escLike } from './rank';

export function slug(s: string): string {
  return s.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

/** The subject keys a matcher set implies, so entries that name the same package or identifier merge. */
export function subjectsOf(m: Matchers): string[] {
  return [
    ...(m.npm ?? []).map((n) => `npm:${n}`),
    ...(m.crates ?? []).map((n) => `crates:${n}`),
    ...(m.identifiers ?? []).map((n) => `id:${n}`),
    ...(m.rpc ?? []).map((n) => `id:${n}`),
    ...(m.config ?? []).map((n) => `id:${n}`),
  ];
}

function candidate(e: Omit<Entry, 'origin'>): Entry {
  return { ...e, origin: 'signal', subjects: [...new Set([...e.subjects, ...subjectsOf(e.matchers)])] };
}

interface RepoRow {
  full_name: string;
  html_url: string;
  description: string | null;
  archived: number;
  /** When a sync saw the repo go from live to archived; null when it was archived before our first look. */
  archived_seen_at: string | null;
  readme_notice: string | null;
  readme_marker: string | null;
  readme_strength: 'strong' | 'weak' | null;
  readme_replacement: string | null;
}

/**
 * Signals 1 and 2: an archived repository and a README that opens with a
 * deprecation notice. The packages whose registry entry links to the
 * repository become the entry's matchers, which is how npm's near-sdk-js
 * gets marked although npm itself carries no flag for it.
 */
export function repoCandidates(db: Database.Database): Entry[] {
  // github_repos.archived_observed_at is the first run that saw the archive,
  // which on a first sync is just today: served as `since`, it dated
  // near-sdk-js's archive to the hour our scratch database was made. Only an
  // observed live-to-archived transition, logged as a change event, is a date.
  const repos = db.prepare(`SELECT r.full_name, r.html_url, r.description, r.archived,
      (SELECT MAX(e.observed_at) FROM change_events e WHERE e.kind = 'repo_archived' AND e.subject = 'github:' || r.full_name) AS archived_seen_at,
      r.readme_notice, r.readme_marker, r.readme_strength, r.readme_replacement
      FROM github_repos r WHERE r.fork = 0 AND (r.archived = 1 OR r.readme_strength IS NOT NULL)`).all() as RepoRow[];
  const packagesOf = db.prepare('SELECT registry, name FROM packages WHERE repository_url = ?');
  return repos.map((r) => {
    const pkgs = packagesOf.all(r.html_url) as Array<{ registry: 'npm' | 'crates'; name: string }>;
    const evidence: Evidence[] = [];
    if (r.archived) {
      // No quote: the GitHub API's archived flag is the evidence, and a
      // sentence written here would be presented as if read at the source.
      evidence.push({ signal: 'repo_archived', strength: 'strong', source_url: r.html_url, quote: null, upstream_date: null, supports: true });
    }
    if (r.readme_strength && r.readme_notice) {
      evidence.push({ signal: 'readme_notice', strength: r.readme_strength === 'strong' ? 'strong' : 'weak', source_url: r.html_url, quote: r.readme_notice, upstream_date: null, supports: true });
    }
    const strong = r.archived || r.readme_strength === 'strong';
    const said = r.readme_notice ? ` Its README opens: "${r.readme_notice}"` : '';
    return candidate({
      id: `repo-${slug(r.full_name)}`,
      title: r.full_name,
      kind: pkgs.length ? (pkgs[0].registry === 'crates' ? 'crate' : 'package') : 'repo',
      status: strong ? 'deprecated' : 'possibly_deprecated',
      summary: `${r.full_name} is ${r.archived ? 'archived on GitHub' : 'still live on GitHub'}.${said}`.trim(),
      replacement: r.readme_replacement,
      replacement_url: r.readme_replacement?.match(/https?:\/\/\S+?(?=\)|$)/)?.[0] ?? null,
      since: r.archived ? r.archived_seen_at?.slice(0, 10) ?? null : null,
      effective: null,
      matchers: {
        npm: pkgs.filter((p) => p.registry === 'npm').map((p) => p.name),
        crates: pkgs.filter((p) => p.registry === 'crates').map((p) => p.name),
      },
      subjects: [`github:${r.full_name}`],
      evidence,
    });
  });
}

/** Signal 3: the registry's own flag (npm `deprecated`, or a crate whose every version is yanked). */
export function registryCandidates(db: Database.Database): Entry[] {
  const rows = db.prepare('SELECT id, registry, name, deprecated, registry_url, latest_version FROM packages WHERE deprecated IS NOT NULL')
    .all() as Array<{ id: string; registry: 'npm' | 'crates'; name: string; deprecated: string; registry_url: string; latest_version: string | null }>;
  return rows.map((p) => candidate({
    id: `pkg-${slug(p.id)}`,
    title: p.name,
    kind: p.registry === 'crates' ? 'crate' : 'package',
    status: 'deprecated',
    summary: `${p.name} is marked deprecated on ${p.registry === 'npm' ? 'npm' : 'crates.io'}: "${p.deprecated}"`,
    replacement: null,
    replacement_url: null,
    since: null,
    effective: null,
    matchers: p.registry === 'npm' ? { npm: [p.name] } : { crates: [p.name] },
    subjects: [],
    evidence: [{ signal: 'registry_flag', strength: 'strong', source_url: p.registry_url, quote: p.deprecated, upstream_date: null, supports: true }],
  }));
}

/**
 * The repositories whose release notes describe a public API. mpc's notes
 * are its contract's and node's internals ("Drop `Result` from
 * `RecentBlocksTracker::add_block`"), which no client code calls.
 */
const REMOVAL_REPOS = new Set([
  'near/nearcore', 'near/near-sdk-rs', 'near/near-api-js', 'near/near-api-rs', 'near/near-cli-rs',
  'near/cargo-near', 'near/near-workspaces-rs', 'near/near-jsonrpc-client-rs',
]);

/** Agents carry roughly this much NEAR history in memory; older removals are long absorbed. */
const REMOVAL_WINDOW_DAYS = 730;

function matchersFor(repo: string, names: string[]): Matchers {
  const m: Matchers = {};
  const add = (k: keyof Matchers, v: string) => { (m[k] ??= []).push(v); };
  for (const n of names) {
    if (/^@[\w.-]+\/[\w.-]+$/.test(n)) add('npm', n);
    else if (/^EXPERIMENTAL_\w+$/.test(n)) add('rpc', n);
    else if (repo === 'near/nearcore' && /^[a-z][a-z0-9_.]*$/.test(n)) add('config', n);
    else if (/^[a-z][a-z0-9-]*$/.test(n) && n.includes('-')) add('config', n);
    else add('identifiers', n);
  }
  return m;
}

function kindFor(repo: string, m: Matchers): EntryKind {
  if (m.npm?.length) return 'package';
  if (m.rpc?.length) return 'rpc_method';
  if (repo === 'near/nearcore') return m.config?.length ? 'config' : 'protocol';
  return 'api';
}

/** Signal 4: what release notes of the last two years say was removed or deprecated. */
export function releaseCandidates(db: Database.Database, now: Date): Entry[] {
  const since = new Date(now.getTime() - REMOVAL_WINDOW_DAYS * 86_400_000).toISOString();
  const rows = db.prepare(`SELECT repo, tag, body, published_at, url FROM github_releases
      WHERE prerelease = 0 AND body IS NOT NULL AND published_at >= ? ORDER BY published_at`).all(since) as
    Array<{ repo: string; tag: string; body: string; published_at: string; url: string }>;
  const out: Entry[] = [];
  for (const r of rows) {
    if (!REMOVAL_REPOS.has(r.repo)) continue;
    const owner = productOfTag(r.repo, r.tag);
    if (!owner) continue;
    for (const rm of extractReleaseRemovals(r.body)) {
      const matchers = matchersFor(r.repo, rm.removed);
      out.push(candidate({
        id: `${owner.product.key}-${slug(rm.removed[0])}`,
        title: rm.removed.length > 1 ? `${rm.removed[0]} and ${rm.removed.length - 1} more` : rm.removed[0],
        kind: kindFor(r.repo, matchers),
        status: rm.action,
        summary: `${owner.product.label} ${owner.version}: ${rm.line}`,
        replacement: null,
        replacement_url: null,
        since: r.published_at.slice(0, 10),
        effective: `${owner.product.label} ${owner.version}`,
        matchers,
        subjects: [],
        evidence: [{ signal: 'release_removal', strength: 'strong', source_url: r.url, quote: rm.line, upstream_date: r.published_at.slice(0, 10), supports: true }],
      }));
    }
  }
  return out;
}

/** Signal 5: the `[Deprecated]` marker of the RPC reference, generated from nearcore's OpenAPI spec. */
export function docsMarkerCandidates(db: Database.Database): Entry[] {
  const pages = db.prepare("SELECT url, content_text FROM doc_pages WHERE source = 'docs' AND url LIKE ? ESCAPE '\\'")
    .all(`${escLike(DOCS_ORIGIN)}/api-reference/%`) as Array<{ url: string; content_text: string }>;
  const known = new Set(pages.map((p) => p.url));
  const out: Entry[] = [];
  for (const p of pages) {
    const marker = extractDocsMarker(p.content_text);
    if (!marker) continue;
    out.push(candidate({
      id: `rpc-${slug(marker.method)}`,
      title: `${marker.method} RPC method`,
      kind: 'rpc_method',
      status: 'deprecated',
      summary: `The RPC reference marks ${marker.method} deprecated: ${marker.line.replace(/^\[Deprecated\]\s*/, '')}`,
      replacement: marker.replacement,
      replacement_url: marker.replacement && known.has(`${DOCS_ORIGIN}/api-reference/post-${marker.replacement.toLowerCase()}`)
        ? `${DOCS_ORIGIN}/api-reference/post-${marker.replacement.toLowerCase()}`
        : null,
      since: null,
      effective: null,
      matchers: { rpc: [marker.method] },
      subjects: [],
      evidence: [{ signal: 'docs_marker', strength: 'strong', source_url: p.url, quote: marker.line, upstream_date: null, supports: true }],
    }));
  }
  return out;
}

/** A matched package released this recently is still being maintained by someone. */
export const ACTIVE_DAYS = 90;

/**
 * Counter-evidence: a package the entry matches has published within
 * ACTIVE_DAYS. It does not refute a deprecation (an archived repo can still
 * ship a last release) but it is what a reader would want to see next to
 * one, and when it is as strong as the support the entry reads as contested.
 */
export function activityEvidence(db: Database.Database, m: Matchers, now: Date): Evidence[] {
  const cutoff = new Date(now.getTime() - ACTIVE_DAYS * 86_400_000).toISOString();
  const ids = [...(m.npm ?? []).map((n) => `npm:${n}`), ...(m.crates ?? []).map((n) => `crates:${n}`)];
  if (ids.length === 0) return [];
  const rows = db.prepare(`SELECT name, latest_version, latest_published_at, registry_url FROM packages
      WHERE id IN (${ids.map(() => '?').join(',')}) AND latest_published_at >= ?`).all(...ids, cutoff) as
    Array<{ name: string; latest_version: string; latest_published_at: string; registry_url: string }>;
  return rows.map((p) => ({
    signal: 'registry_activity' as const,
    strength: 'medium' as const,
    source_url: p.registry_url,
    quote: `${p.name} ${p.latest_version} published ${p.latest_published_at.slice(0, 10)}`,
    upstream_date: p.latest_published_at.slice(0, 10),
    supports: false,
  }));
}

/** Days after which a package with no release and a named successor is probably left behind. */
export const DORMANT_DAYS = 365;

/**
 * Signal 6, weak: a matched package has had no release for a year while the
 * entry names a successor. It only ever adds evidence to an entry that
 * already exists; a quiet package without a successor is just quiet.
 */
export function dormancyEvidence(db: Database.Database, m: Matchers, now: Date): Evidence[] {
  const cutoff = new Date(now.getTime() - DORMANT_DAYS * 86_400_000).toISOString();
  const ids = [...(m.npm ?? []).map((n) => `npm:${n}`), ...(m.crates ?? []).map((n) => `crates:${n}`)];
  if (ids.length === 0) return [];
  const rows = db.prepare(`SELECT name, latest_version, latest_published_at, registry_url FROM packages
      WHERE id IN (${ids.map(() => '?').join(',')}) AND latest_published_at < ?`).all(...ids, cutoff) as
    Array<{ name: string; latest_version: string; latest_published_at: string; registry_url: string }>;
  return rows.map((p) => ({
    signal: 'dormant_with_successor' as const,
    strength: 'weak' as const,
    source_url: p.registry_url,
    quote: `${p.name} ${p.latest_version} is the latest release, published ${p.latest_published_at.slice(0, 10)}`,
    upstream_date: p.latest_published_at.slice(0, 10),
    supports: true,
  }));
}
