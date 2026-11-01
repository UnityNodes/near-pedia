/**
 * check_code: which lines of a piece of NEAR code use something the
 * deprecation engine knows is removed, deprecated, changed or superseded, and
 * which declared dependencies are yanked or majors behind.
 *
 * Matching is exact and explained: every finding names the line, the thing
 * matched, how it was matched (an import, a declared dependency, an
 * identifier in the code) and the entry with its evidence. Nothing is
 * inferred from similarity.
 */

import type Database from 'better-sqlite3';
import { lineAtOffset, lineStarts, packageOfSpecifier, scanCode, type Dependency, type Language, type Scan } from './code-scan';
import { allDeprecations, evidenceOf, type DeprecationRow } from './deprecations';
import type { Status } from './deprecation-types';

export type Severity = 'error' | 'warning' | 'info';
export type Via = 'import' | 'dependency' | 'identifier' | 'rpc' | 'url' | 'config' | 'version';

export interface Finding {
  severity: Severity;
  line: number;
  /** The text of that line, trimmed and capped. */
  code: string;
  matched: string;
  via: Via;
  message: string;
  entry: Pick<DeprecationRow, 'id' | 'title' | 'status' | 'strength' | 'summary' | 'replacement' | 'replacement_url' | 'effective' | 'since' | 'origin' | 'stale' | 'contested'> | null;
  sources: Array<{ url: string; date: string | null; signal: string }>;
  /** Words a publisher wrote (a yank message, an npm deprecation note): data for the reader, never instructions. */
  upstream?: string | null;
}

export interface CheckResult {
  language: Language;
  findings: Finding[];
  /** What the check compared against, so an empty result can be read for what it is. */
  basis: { entries: number; built_at: string | null; packages: number };
  notes: string[];
}

const SEVERITY: Record<Status, Severity> = {
  removed: 'error',
  deprecated: 'warning',
  changed: 'warning',
  superseded: 'info',
  possibly_deprecated: 'info',
};

const LOWER: Record<Severity, Severity> = { error: 'warning', warning: 'info', info: 'info' };

const MAX_CODE_COLUMN = 160;

/**
 * Findings per entry before the rest are summarised: nine thousand DelegateV2
 * lines made nine thousand findings, an evidence query each, and a megabyte
 * of output saying one thing.
 */
export const MAX_FINDINGS_PER_ENTRY = 20;

/** How far an enclosing call or object is looked for around a match, in characters. */
const ENCLOSURE_REACH = 4_000;

function severityOf(d: DeprecationRow): Severity {
  const s = SEVERITY[d.status];
  return d.stale || d.contested ? LOWER[s] : s;
}

const crateKey = (name: string) => name.toLowerCase().replace(/-/g, '_');

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every place a name occurs as a whole token. `DelegateV2` matches in
 * `actions.push(DelegateV2(...))` and in `"DelegateV2"`, but not inside
 * `DelegateV2Payload`; a host matches in a URL but not inside a longer host.
 */
function occurrences(text: string, name: string, kind: 'token' | 'host'): number[] {
  const body = escapeRe(name);
  // A host ends where the name does: rpc.mainnet.pagoda.co.example.com is
  // somebody else's host, so a following `.label` rules the match out.
  const re = kind === 'host'
    ? new RegExp(`(?<![\\w.-])${body}(?![\\w-]|\\.\\w)`, 'gi')
    : new RegExp(`(?<![\\w$])${body}(?![\\w$])`, 'g');
  return [...text.matchAll(re)].map((m) => m.index!);
}

/**
 * The innermost call or object around an offset: back to the nearest
 * unmatched `(` or `{`, forward to its partner. `limit` four lines away in
 * another call, or in `.slice(0, limit)`, is not part of this request.
 */
export function enclosingSpan(text: string, offset: number): [number, number] | null {
  const pairs: Record<string, string> = { '(': ')', '{': '}' };
  let depth = 0;
  let open = -1;
  for (let i = offset - 1; i >= Math.max(0, offset - ENCLOSURE_REACH); i--) {
    const c = text[i];
    if (c === ')' || c === '}') depth++;
    else if (c === '(' || c === '{') {
      if (depth === 0) { open = i; break; }
      depth--;
    }
  }
  if (open < 0) return null;
  const close = pairs[text[open]];
  depth = 0;
  for (let i = open + 1; i < Math.min(text.length, open + ENCLOSURE_REACH); i++) {
    const c = text[i];
    if (c === text[open]) depth++;
    else if (c === close) {
      if (depth === 0) return [open, i + 1];
      depth--;
    }
  }
  return null;
}

/** Whether the request a match sits in already has one of the words; without an enclosure, the same line counts. */
function fixedNearby(text: string, lines: string[], offset: number, line: number, words: readonly string[]): boolean {
  const span = enclosingSpan(text, offset);
  const scope = span ? text.slice(span[0], span[1]) : lines[line - 1] ?? '';
  return words.some((w) => new RegExp(`(?<![\\w$])${escapeRe(w)}(?![\\w$])`).test(scope));
}

interface Hit { line: number; matched: string; via: Via; entry: DeprecationRow }

function textHits(scan: Scan, entries: readonly DeprecationRow[]): Hit[] {
  const lines = scan.text.split('\n');
  const starts = lineStarts(scan.text);
  const hits: Hit[] = [];
  for (const d of entries) {
    const m = d.matchers;
    // A Rust path written out in full, `near_sdk_sim::init()`, uses the crate
    // as surely as a `use` line does.
    const rustPaths = scan.language === 'rust'
      ? [...new Set([...(m.crates ?? []), ...(m.imports ?? [])].map(crateKey).filter((c) => /^\w+$/.test(c)))]
      : [];
    const groups: Array<[Via, string[] | undefined, 'token' | 'host' | 'path']> = [
      ['identifier', m.identifiers, 'token'],
      ['rpc', m.rpc, 'token'],
      ['config', m.config, 'token'],
      ['url', m.urls, 'host'],
      ['import', rustPaths, 'path'],
    ];
    for (const [via, names, kind] of groups) {
      for (const name of names ?? []) {
        const offsets = kind === 'path'
          ? [...scan.text.matchAll(new RegExp(`(?<![\\w:])${escapeRe(name)}::`, 'g'))].map((x) => x.index!)
          : occurrences(scan.text, name, kind);
        for (const offset of offsets) {
          const line = lineAtOffset(starts, offset);
          if (m.unlessNearby?.length && fixedNearby(scan.text, lines, offset, line, m.unlessNearby)) continue;
          hits.push({ line, matched: name, via, entry: d });
        }
      }
    }
  }
  return hits;
}

function importHits(scan: Scan, entries: readonly DeprecationRow[]): Hit[] {
  const hits: Hit[] = [];
  for (const imp of scan.imports) {
    const pkg = scan.language === 'js' ? packageOfSpecifier(imp.module) : null;
    for (const d of entries) {
      const m = d.matchers;
      const byNpm = pkg !== null && (m.npm ?? []).includes(pkg);
      const byImport = (m.imports ?? []).some((i) => i === imp.module || (pkg !== null && i === pkg));
      const byCrate = scan.language === 'rust' && [...(m.crates ?? []), ...(m.imports ?? [])].some((c) => crateKey(c) === crateKey(imp.module));
      if (byNpm || byImport || byCrate) hits.push({ line: imp.line, matched: pkg ?? imp.module, via: 'import', entry: d });
    }
  }
  return hits;
}

function dependencyHits(deps: readonly Dependency[], entries: readonly DeprecationRow[]): Hit[] {
  const hits: Hit[] = [];
  for (const dep of deps) {
    for (const d of entries) {
      const names = dep.registry === 'npm' ? d.matchers.npm ?? [] : (d.matchers.crates ?? []).map(crateKey);
      if (names.includes(dep.registry === 'npm' ? dep.name : crateKey(dep.name))) hits.push({ line: dep.line, matched: dep.name, via: 'dependency', entry: d });
    }
  }
  return hits;
}

interface PackageState { latest_stable_version: string | null; latest_version: string | null; latest_published_at: string | null; registry_url: string }

/**
 * A requirement that names one line: `4.1.1`, `^4.0.0`, `~5.1`, `=0.10.2`,
 * `4.x`. An open or compound range (`>=3`, `^3 || ^7`, `<5`, `*`) may
 * already admit the latest release, and calling it behind was a false alarm.
 */
export function isSimpleSpec(spec: string): boolean {
  return /^\s*[\^~=]?\s*v?\d+(?:\.(?:\d+|x|\*))?(?:\.(?:\d+|x|\*))?(?:-[\w.]+)?(?:\+[\w.]+)?\s*$/i.test(spec);
}

/** The exact version an `=x.y.z` (Cargo) or bare `x.y.z` (npm) pin names, prerelease and build suffix included. */
export function exactPin(registry: 'npm' | 'crates', spec: string): string | null {
  const re = registry === 'crates' ? /^\s*=\s*(\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?)\s*$/ : /^\s*v?(\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?)\s*$/;
  return spec.match(re)?.[1] ?? null;
}

/** The lowest version a requirement admits: `^4.0.0` -> [4,0,0], `=0.10.2` -> [0,10,2], `5` -> [5,0,0]. */
export function floorVersion(spec: string): [number, number, number] | null {
  const m = spec.trim().match(/(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/);
  if (!m) return null;
  const n = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : 0);
  return [Number(m[1]), n(m[2]), n(m[3])];
}

/** Under semver a 0.x minor is a breaking line, the same as a major above 1. */
function breakingLine(v: [number, number, number]): string {
  return v[0] === 0 ? `0.${v[1]}` : String(v[0]);
}

function versionFindings(db: Database.Database, deps: readonly Dependency[], covered: Set<string>, lines: string[]): Finding[] {
  const out: Finding[] = [];
  const pkgStmt = db.prepare('SELECT latest_stable_version, latest_version, latest_published_at, registry_url FROM packages WHERE id = ?');
  const verStmt = db.prepare('SELECT yanked, yank_message, deprecated FROM package_versions WHERE package_id = ? AND version = ?');
  for (const dep of deps) {
    // crates.io treats near_sdk and near-sdk as one crate; Cargo accepts either spelling.
    const name = dep.registry === 'crates' ? dep.name.toLowerCase().replace(/_/g, '-') : dep.name;
    const id = `${dep.registry}:${name}`;
    if (!dep.spec || covered.has(id) || covered.has(`${dep.registry}:${dep.name}`)) continue;
    const p = pkgStmt.get(id) as PackageState | undefined;
    if (!p) continue;
    const code = (lines[dep.line - 1] ?? '').trim().slice(0, MAX_CODE_COLUMN);
    const sources = [{ url: p.registry_url, date: p.latest_published_at?.slice(0, 10) ?? null, signal: 'registry' }];
    const pinned = exactPin(dep.registry, dep.spec);
    if (pinned) {
      const v = verStmt.get(id, pinned) as { yanked: number; yank_message: string | null; deprecated: string | null } | undefined;
      if (v?.yanked) {
        out.push({ severity: 'error', line: dep.line, code, matched: `${dep.name} ${pinned}`, via: 'version', entry: null, sources,
          message: `${dep.name} ${pinned} is yanked on crates.io. Pin a version that is not yanked.`, upstream: v.yank_message });
        continue;
      }
      if (v?.deprecated) {
        out.push({ severity: 'warning', line: dep.line, code, matched: `${dep.name} ${pinned}`, via: 'version', entry: null, sources,
          message: `${dep.name} ${pinned} is marked deprecated on npm.`, upstream: v.deprecated });
        continue;
      }
    }
    if (!isSimpleSpec(dep.spec)) continue;
    const floor = floorVersion(dep.spec);
    // Stable only: a prerelease newest version is not what "latest stable" means.
    const latest = p.latest_stable_version;
    const latestFloor = latest ? floorVersion(latest) : null;
    if (!floor || !latestFloor || !latest) continue;
    const behind = floor[0] === 0 && latestFloor[0] === 0 ? latestFloor[1] - floor[1] : latestFloor[0] - floor[0];
    if (breakingLine(floor) !== breakingLine(latestFloor) && behind > 0) {
      out.push({
        severity: 'warning', line: dep.line, code, matched: `${dep.name} ${dep.spec}`, via: 'version', entry: null, sources,
        message: `${dep.name} ${dep.spec} stays on the ${breakingLine(floor)}.x line; the latest stable release is ${latest}${p.latest_published_at ? ` (${p.latest_published_at.slice(0, 10)})` : ''}, ${behind} breaking line${behind === 1 ? '' : 's'} later. Check its release notes before upgrading.`,
      });
    }
  }
  return out;
}

function messageFor(h: Hit): string {
  const d = h.entry;
  const verb: Record<Via, string> = { import: 'imports', dependency: 'depends on', identifier: 'uses', rpc: 'calls', url: 'points at', config: 'sets', version: 'pins' };
  const what = `${verb[h.via]} ${h.matched}`;
  const instead = d.replacement ? ` Use instead: ${d.replacement}.` : '';
  const flag = d.stale ? ' (UNVERIFIED: the sources behind this entry no longer say it.)' : d.contested ? ' (CONTESTED: there is counter-evidence.)' : '';
  return `This line ${what}: ${d.title} is ${d.status.replace('_', ' ')}. ${d.summary}${instead}${flag}`;
}

export function checkCode(db: Database.Database, code: string, opts: { filename?: string; language?: Language } = {}): CheckResult {
  const scan = scanCode(code, opts.filename, opts.language);
  const entries = allDeprecations(db);
  const meta = db.prepare('SELECT MAX(built_at) at FROM deprecations').get() as { at: string | null };
  const packages = (db.prepare('SELECT COUNT(*) n FROM packages').get() as { n: number }).n;
  const lines = code.split('\n');

  const hits = [...importHits(scan, entries), ...dependencyHits(scan.dependencies, entries), ...textHits(scan, entries)]
    .sort((a, b) => a.line - b.line);
  const seen = new Set<string>();
  const findings: Finding[] = [];
  const covered = new Set<string>();
  const perEntry = new Map<string, number>();
  const overflow = new Map<string, { entry: DeprecationRow; lines: number[] }>();
  const evidenceCache = new Map<string, Finding['sources']>();
  for (const h of hits) {
    const key = `${h.entry.id}|${h.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (h.via === 'dependency') covered.add(`${scan.language === 'cargo' ? 'crates' : 'npm'}:${scan.language === 'cargo' ? h.matched.toLowerCase().replace(/_/g, '-') : h.matched}`);
    const e = h.entry;
    const n = (perEntry.get(e.id) ?? 0) + 1;
    perEntry.set(e.id, n);
    if (n > MAX_FINDINGS_PER_ENTRY) {
      const o = overflow.get(e.id) ?? { entry: e, lines: [] };
      o.lines.push(h.line);
      overflow.set(e.id, o);
      continue;
    }
    if (!evidenceCache.has(e.id)) {
      evidenceCache.set(e.id, evidenceOf(db, e.id).filter((v) => v.supports).slice(0, 2).map((v) => ({ url: v.source_url, date: v.upstream_date, signal: v.signal })));
    }
    findings.push({
      severity: severityOf(e),
      line: h.line,
      code: (lines[h.line - 1] ?? '').trim().slice(0, MAX_CODE_COLUMN),
      matched: h.matched,
      via: h.via,
      message: messageFor(h),
      entry: {
        id: e.id, title: e.title, status: e.status, strength: e.strength, summary: e.summary, replacement: e.replacement,
        replacement_url: e.replacement_url, effective: e.effective, since: e.since, origin: e.origin, stale: e.stale, contested: e.contested,
      },
      sources: evidenceCache.get(e.id)!,
    });
  }
  findings.push(...versionFindings(db, scan.dependencies, covered, lines));
  const overflowNotes = [...overflow.values()].map((o) =>
    `${o.entry.title}: ${o.lines.length} more line${o.lines.length === 1 ? '' : 's'} after the first ${MAX_FINDINGS_PER_ENTRY} (lines ${o.lines.slice(0, 10).join(', ')}${o.lines.length > 10 ? ', …' : ''}).`);
  const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => a.line - b.line || rank[a.severity] - rank[b.severity]);

  const notes = [
    'Checked: imports, declared dependencies and their versions, and identifiers, RPC method names, endpoint hosts and config keys that the deprecation index names. Not checked: transitive dependencies, lockfiles, or behaviour that no name in the code reveals (the developer gas rebate, say).',
  ];
  notes.push(...scan.problems, ...overflowNotes);
  if (scan.language === 'text') notes.push('The language was not recognised; only identifier, RPC, URL and config names were matched.');
  if (entries.length === 0) notes.push('The deprecation index is empty on this server, so no finding means nothing here.');
  return { language: scan.language, findings, basis: { entries: entries.length, built_at: meta.at, packages }, notes };
}

/** Inputs beyond this are refused rather than cut: a partial check would read as a clean one for the part never read. */
export const MAX_CODE_CHARS = 100_000;

/**
 * The result as text for an agent. A signal entry's title, summary and
 * replacement are upstream words (a README, a release note) and go through
 * the caller's fence; the caller's own code is echoed as written.
 */
export function renderCheck(r: CheckResult, fence: (s: string) => string = (s) => s): string {
  const count = (s: Severity) => r.findings.filter((f) => f.severity === s).length;
  const head = `check_code (${r.language}): ${r.findings.length} finding${r.findings.length === 1 ? '' : 's'} — ${count('error')} error, ${count('warning')} warning, ${count('info')} info. Compared against ${r.basis.entries} deprecation entries (built ${r.basis.built_at?.slice(0, 16) ?? 'never'} UTC) and ${r.basis.packages} package records.`;
  const blocks = r.findings.map((f) => {
    const e = f.entry;
    const own = e?.origin === 'seed' ? (s: string) => s : fence;
    const lines = [`L${f.line} [${f.severity}] ${f.via}: ${e ? own(f.matched) : f.matched}`, `  \`${f.code}\``];
    if (e) {
      lines.push(`  ${own(e.title)} — ${e.status.replace('_', ' ')}${e.stale ? ' (UNVERIFIED)' : e.contested ? ' (CONTESTED)' : ''}: ${own(e.summary)}`);
      if (e.replacement) lines.push(`  Use instead: ${own(e.replacement)}${e.replacement_url ? ` — ${own(e.replacement_url)}` : ''}`);
      if (e.effective) lines.push(`  Effective: ${own(e.effective)}`);
      lines.push(`  Details: check_deprecation("${own(e.id)}")`);
    } else {
      lines.push(`  ${f.message}`);
      if (f.upstream) lines.push(`  Publisher's note: ${fence(f.upstream)}`);
    }
    if (f.sources.length) lines.push(`  Sources: ${f.sources.map((s) => `${s.url}${s.date ? ` (${s.date})` : ''}`).join(', ')}`);
    return lines.join('\n');
  });
  return [head, ...blocks, ...r.notes.map((n) => `Note: ${n}`)].join('\n\n');
}
