/**
 * Three of the code tools, over the synced NEAR data:
 *
 *   resolve_package     an npm or crates.io package (optionally at a version):
 *                       latest, yanked or deprecated flags, and the
 *                       deprecation entry with its replacement
 *   get_breaking_changes  the releases of one NEAR product between two
 *                       versions, with the removals and deprecations their
 *                       notes announce and nearcore's upgrade flags
 *   explain_error       an error text matched against lib/near-errors.ts,
 *                       the deprecation entries for names it contains, and
 *                       forum threads and GitHub issues that quote it
 *
 * Release notes, forum and issue text are upstream content and go through
 * the caller's fence.
 */

import type Database from 'better-sqlite3';
import { compareVersions } from './release-version';
import { RELEASE_PRODUCT_SPECS, versionFromTag, type ReleaseProductSpec } from './release-sources';
import { extractReleaseRemovals } from './deprecation-extract';
import { findDeprecations, renderDeprecation, type DeprecationMatch } from './deprecations';
import { releaseUrgency } from './near-radar';
import { matchErrors, type KnownError } from './near-errors';
import { namesIn } from './ask';
import { escLike } from './rank';

type Fence = (s: string) => string;

const tryTable = <T>(f: () => T, empty: T): T => {
  try {
    return f();
  } catch (e) {
    if (/no such table/.test((e as Error).message)) return empty;
    throw e;
  }
};

// ── resolve_package ──────────────────────────────────────────────────────────

interface PackageRow {
  id: string; registry: string; name: string; description: string | null; latest_version: string | null; latest_published_at: string | null;
  latest_stable_version: string | null; deprecated: string | null; repository_url: string | null; registry_url: string | null; versions_count: number; synced_at: string | null;
}
interface VersionRow { version: string; published_at: string | null; deprecated: string | null; yanked: number; yank_message: string | null }

/** `near-api-js`, `near-api-js@7.4.0`, `crates:near-sdk`, `near-sdk@5.30.0`: the package, its registry when given, and the version when given. */
export function parsePackageRef(raw: string): { registry: 'npm' | 'crates' | null; name: string; version: string | null } {
  let s = raw.trim();
  let registry: 'npm' | 'crates' | null = null;
  const pre = s.match(/^(npm|crates)[:/](.+)$/i);
  if (pre) {
    registry = pre[1].toLowerCase() as 'npm' | 'crates';
    s = pre[2];
  }
  const at = s.lastIndexOf('@');
  if (at > 0) return { registry, name: s.slice(0, at), version: s.slice(at + 1).replace(/^[=^~v]+/, '') || null };
  return { registry, name: s, version: null };
}

export interface ResolvedPackage { pkg: PackageRow; version: VersionRow | null; versionAsked: string | null; deprecations: DeprecationMatch[]; newer: number }

export function resolvePackages(db: Database.Database, raw: string): ResolvedPackage[] {
  const ref = parsePackageRef(raw);
  const pkgs = db.prepare(`SELECT id, registry, name, description, latest_version, latest_published_at, latest_stable_version, deprecated, repository_url, registry_url, versions_count, synced_at
    FROM packages WHERE lower(name) = lower(?) ${ref.registry ? 'AND registry = ?' : ''} ORDER BY registry`).all(...[ref.name, ...(ref.registry ? [ref.registry] : [])]) as PackageRow[];
  const versions = db.prepare('SELECT version, published_at, deprecated, yanked, yank_message FROM package_versions WHERE package_id = ?');
  return pkgs.map((pkg) => {
    const all = versions.all(pkg.id) as VersionRow[];
    const version = ref.version ? all.find((v) => v.version === ref.version) ?? null : null;
    const newer = ref.version ? all.filter((v) => !v.yanked && !/-/.test(v.version) && compareVersions(v.version, ref.version!) > 0).length : 0;
    const deprecations = tryTable(() => findDeprecations(db, pkg.name, 3).filter((d) => d.match !== 'text'), []);
    return { pkg, version, versionAsked: ref.version, deprecations, newer };
  });
}

export function renderPackage(r: ResolvedPackage, fence: Fence): string {
  const p = r.pkg;
  const lines = [
    `${p.registry}: ${p.name}  ·  latest ${p.latest_version ?? '?'}${p.latest_stable_version && p.latest_stable_version !== p.latest_version ? `, latest stable ${p.latest_stable_version}` : ''}${p.latest_published_at ? ` (${p.latest_published_at.slice(0, 10)})` : ''}  ·  ${p.versions_count} versions`,
  ];
  if (p.description) lines.push(`  ${fence(p.description.slice(0, 200))}`);
  if (p.deprecated) lines.push(`  DEPRECATED on ${p.registry}: ${fence(p.deprecated)}`);
  if (r.versionAsked) {
    if (!r.version) lines.push(`  ${fence(r.versionAsked)}: not a published version of ${fence(p.name)}`);
    else {
      const v = r.version;
      lines.push(`  ${fence(v.version)}${v.published_at ? ` (${v.published_at.slice(0, 10)})` : ''}: ${v.yanked ? `YANKED${v.yank_message ? `: ${fence(v.yank_message)}` : ''}` : v.deprecated ? `DEPRECATED: ${fence(v.deprecated)}` : 'published, not yanked or deprecated'}${r.newer ? `; ${r.newer} newer stable version(s)` : '; no newer stable version'}`);
    }
  }
  for (const d of r.deprecations) lines.push('', renderDeprecation(d, fence));
  lines.push(`  ${p.registry_url ?? ''}${p.repository_url ? `  ·  ${fence(p.repository_url)}` : ''}  ·  synced ${p.synced_at?.slice(0, 16) ?? '?'} UTC`);
  return lines.join('\n');
}

// ── get_breaking_changes ─────────────────────────────────────────────────────

export function productOf(raw: string): ReleaseProductSpec | null {
  const k = raw.trim().toLowerCase().replace(/^near\//, '');
  return RELEASE_PRODUCT_SPECS.find((p) => p.key === k || p.repo.toLowerCase() === raw.trim().toLowerCase() || p.repo.split('/')[1].toLowerCase() === k || p.label.toLowerCase() === k) ?? null;
}

export interface ReleaseStep {
  tag: string; version: string; published_at: string | null; url: string; prerelease: boolean;
  removals: ReturnType<typeof extractReleaseRemovals>;
  breaking: string[];
  code: string | null; protocol_upgrade: boolean; security: boolean;
}

/** A heading that opens breaking notes: "Breaking Changes", and changesets' "Major Changes". */
const BREAKING_HEADING = /breaking|major changes/i;
/** "**Breaking Changes**" written as a bold line inside a list, as changesets does. */
const BOLD_BREAKING = /^\s*(?:[-*+]\s+)?\*\*\s*breaking changes?\s*\*\*\s*$/i;
/** Prose that announces a break without a heading or a bullet (near-api-js 6.0.0). */
const BREAKING_PROSE = /\b(?:has been (?:deprecated|removed)|(?:is|are) no longer (?:exported|supported|available|used)|no longer (?:exported|built|supported)|was (?:completely )?(?:overwritten|rewritten|removed)|received major changes|(?<!non-|not |no )breaking change)/i;
/** "non-breaking change", "not breaking changes": a line that says it breaks nothing. */
const NOT_BREAKING = /\b(?:non-breaking|not (?:a )?breaking|no breaking)\b/i;
/** The "[#1353](…) [`7369055`](…) Thanks [@someone](…)! - " prefix of a changesets line. */
const CHANGESET_PREFIX = /^(?:\[#\d+\]\([^)]*\)\s*)?(?:\[`?[0-9a-f]{7,40}`?\]\([^)]*\)\s*)?(?:Thanks \[@[^\]]+\]\([^)]*\)!\s*-\s*)?/;

const clean = (line: string): string => line.replace(/^\s*[-*+]\s+/, '').trim().replace(CHANGESET_PREFIX, '').slice(0, 300);

/**
 * Lines a release marks as breaking: bullets under a "Breaking" or "Major
 * Changes" heading or a bold "Breaking Changes" line, bullets that say so
 * themselves, and prose sentences that announce a removal or deprecation.
 */
export function breakingLines(body: string): string[] {
  const out: string[] = [];
  let inBreaking = false;
  for (const raw of body.split(/\r?\n/)) {
    const h = raw.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      inBreaking = BREAKING_HEADING.test(h[1]);
      continue;
    }
    if (BOLD_BREAKING.test(raw)) {
      inBreaking = true;
      continue;
    }
    if (NOT_BREAKING.test(raw)) continue;
    if (/^\s*[-*+]\s/.test(raw)) {
      if (inBreaking || /\bBREAKING\b|\[breaking\]|⚠️|breaking change/i.test(raw)) out.push(clean(raw));
    } else if (raw.trim() && BREAKING_PROSE.test(raw)) {
      out.push(clean(raw));
    }
  }
  return [...new Set(out.filter(Boolean))].slice(0, 20);
}

export function releasesBetween(db: Database.Database, product: ReleaseProductSpec, from: string, to: string): ReleaseStep[] {
  const rows = db.prepare('SELECT tag, url, published_at, body, prerelease FROM github_releases WHERE repo = ?').all(product.repo) as Array<{ tag: string; url: string; published_at: string | null; body: string | null; prerelease: number }>;
  const includePre = /-/.test(to);
  return rows
    .map((r) => ({ r, version: versionFromTag(product, r.tag) }))
    .filter((x): x is { r: typeof rows[number]; version: string } => x.version !== null)
    .filter(({ r, version }) => (includePre || !r.prerelease) && compareVersions(version, from) > 0 && compareVersions(version, to) <= 0)
    .sort((a, b) => compareVersions(a.version, b.version))
    .map(({ r, version }) => {
      const body = r.body ?? '';
      const urgency = releaseUrgency(body);
      return {
        tag: r.tag, version, published_at: r.published_at, url: r.url, prerelease: r.prerelease === 1,
        removals: extractReleaseRemovals(body), breaking: breakingLines(body),
        code: urgency.code, protocol_upgrade: /^\s*PROTOCOL_UPGRADE:\s*TRUE\s*$/im.test(body), security: urgency.security,
      };
    });
}

export function renderBreaking(product: ReleaseProductSpec, from: string, to: string, steps: readonly ReleaseStep[], fence: Fence): string {
  const head = `${product.label} ${fence(from)} → ${fence(to)}: ${steps.length} release(s) in between (${product.repo}).`;
  if (steps.length === 0) return `${head}\nNo synced release of ${product.label} falls in that range; check the versions: resolve_package gives the published ones.`;
  const parts = [head];
  const major = (v: string): number => Number(/^(\d+)/.exec(v)?.[1] ?? NaN);
  // Releases with nothing to report are folded into one line per run, so the
  // ones that break something are not buried among thirty that do not.
  let quiet: ReleaseStep[] = [];
  const flushQuiet = () => {
    if (!quiet.length) return;
    const span = quiet.length === 1 ? fence(quiet[0].version) : `${fence(quiet[0].version)} … ${fence(quiet[quiet.length - 1].version)} (${quiet.length} releases)`;
    parts.push(`${span}: no removal, deprecation or breaking line in the notes`);
    quiet = [];
  };
  let previous = from;
  for (const s of steps) {
    const newMajor = major(s.version) > major(previous);
    previous = s.version;
    const flags = [s.code, s.protocol_upgrade ? 'PROTOCOL_UPGRADE' : '', s.security ? 'SECURITY_UPGRADE' : '', s.prerelease ? 'prerelease' : ''].filter(Boolean).join(', ');
    const lines = [`## ${fence(s.version)}${s.published_at ? ` (${s.published_at.slice(0, 10)})` : ''}${flags ? `  [${flags}]` : ''}  ${s.url}`];
    for (const r of s.removals) lines.push(`- ${r.action.toUpperCase()}: ${fence(r.line)}`);
    for (const b of s.breaking) if (!s.removals.some((r) => r.line.includes(b.slice(0, 40)))) lines.push(`- BREAKING: ${fence(b)}`);
    if (lines.length === 1 && !flags && !newMajor) {
      quiet.push(s);
      continue;
    }
    flushQuiet();
    if (lines.length === 1) lines.push(newMajor
      ? '- a new major version, and no line in its notes reads as a removal or a break: read them before upgrading'
      : '- no removal, deprecation or breaking line in the notes');
    parts.push(lines.join('\n'));
  }
  flushQuiet();
  return parts.join('\n\n');
}

// ── explain_error ────────────────────────────────────────────────────────────

export interface ErrorExplanation {
  /** The token GitHub issues were matched on. */
  token: string | null;
  known: KnownError[];
  deprecations: DeprecationMatch[];
  forum: Array<{ title: string; url: string; created_at: string | null }>;
  github: Array<{ title: string; url: string; repo: string; state: string | null; created_at: string | null }>;
}

/** The distinctive tokens of an error text: CONSTANT_CASE codes, CamelCase variants and long words. */
export function errorTokens(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.slice(0, 4000).match(/\b[A-Z][A-Z0-9_]{5,}\b|\b[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+\b/g) ?? []) out.add(m);
  for (const m of text.slice(0, 4000).match(/\b[a-z][a-z0-9_]{7,}\b/gi) ?? []) if (out.size < 8) out.add(m);
  return [...out].slice(0, 8);
}

export function explainError(db: Database.Database, text: string, limit = 3): ErrorExplanation {
  const known = matchErrors(text);
  const seen = new Map<string, DeprecationMatch>();
  for (const name of namesIn(text)) for (const d of tryTable(() => findDeprecations(db, name, 2), [])) if (d.match !== 'text') seen.set(d.id, d);
  const tokens = errorTokens(text);
  const fts = tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
  const forum = fts ? tryTable(() => db.prepare(`SELECT ft.title, ft.url, ft.created_at FROM forum_fts JOIN forum_topics ft ON ft.id = forum_fts.rowid
    WHERE forum_fts MATCH ? ORDER BY rank LIMIT ?`).all(fts, limit) as ErrorExplanation['forum'], []) : [];
  // A recognised error is looked up by the words it was recognised by
  // ("Exceeded the prepaid gas"), not by its first word: "Exceeded" alone
  // matched agent-framework issues about unrelated limits.
  const recognised = known.map((k) => { const m = k.match.exec(text); return m?.[1] ?? m?.[0]; }).find((m): m is string => !!m && m.length >= 6);
  const first = recognised ?? tokens[0];
  const github = first ? tryTable(() => db.prepare(`SELECT title, url, repo, state, created_at FROM github_items
    WHERE title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' ORDER BY (repo LIKE 'near/%') DESC, created_at DESC LIMIT ?`).all(`%${escLike(first)}%`, `%${escLike(first)}%`, limit) as ErrorExplanation['github'], []) : [];
  return { token: first ?? null, known, deprecations: [...seen.values()].slice(0, 3), forum, github };
}

export function renderExplanation(x: ErrorExplanation, fence: Fence): string {
  const parts: string[] = [];
  for (const k of x.known) parts.push(`## ${k.title}\nCause: ${k.cause}\nFix: ${k.fix}\nSource: ${k.source_url}`);
  for (const d of x.deprecations) parts.push(renderDeprecation(d, fence));
  if (x.forum.length) parts.push(`## Forum threads quoting it\n${x.forum.map((f) => `- ${fence(f.title)} (${f.created_at?.slice(0, 10) ?? ''}) ${f.url}`).join('\n')}`);
  if (x.github.length) parts.push(`## GitHub issues mentioning ${fence(x.token ?? '')}\n${x.github.map((g) => `- ${fence(g.title)} · ${g.repo} · ${g.state ?? ''} · ${g.created_at?.slice(0, 10) ?? ''} ${g.url}`).join('\n')}`);
  return parts.length ? parts.join('\n\n') : 'Nothing in the error catalog, the deprecation index, the forum or GitHub matches this error. Paste the full message, or search the docs with semantic_search.';
}
