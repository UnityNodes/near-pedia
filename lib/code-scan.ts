/**
 * What a piece of code depends on and names, for check_code: its imports, its
 * declared dependencies with their version specs, and its text with comments
 * blanked out (line structure kept), for the identifier, RPC, URL and config
 * matchers. A comment that names a deprecated API is not a use of it.
 */

import { stripJsComments, stripRustComments, stripTomlComments } from './strip-comments';

export const LANGUAGES = ['js', 'rust', 'cargo', 'package-json', 'json', 'toml', 'text'] as const;
export type Language = typeof LANGUAGES[number];

export interface ImportRef {
  /** As written: `near-sdk-js`, `@near-js/accounts/lib/x`, or a Rust crate root `near_sdk`. */
  module: string;
  line: number;
}

export interface Dependency {
  registry: 'npm' | 'crates';
  name: string;
  /** The version requirement as written, or null for git/path/workspace dependencies. */
  spec: string | null;
  line: number;
}

export interface Scan {
  language: Language;
  /** The code with comments blanked; same length and line breaks as the input. */
  text: string;
  imports: ImportRef[];
  dependencies: Dependency[];
  /** What the scan could not read, so an empty result is not mistaken for a clean one. */
  problems: string[];
}

const CARGO_HEADER = /^\s*\[(?:target\.[^\]]+\.)?(?:workspace\.)?(?:dev-|build-)?dependencies(?:\.[^\]]+)?\]/m;

export function detectLanguage(code: string, filename?: string): Language {
  const name = (filename ?? '').toLowerCase().split(/[\\/]/).pop() ?? '';
  if (name === 'cargo.toml') return 'cargo';
  if (name === 'package.json') return 'package-json';
  if (/\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/.test(name)) return 'js';
  if (name.endsWith('.rs')) return 'rust';
  if (name.endsWith('.toml')) return CARGO_HEADER.test(code) ? 'cargo' : 'toml';
  if (name.endsWith('.json')) return /"(?:dev|peer|optional)?[dD]ependencies"\s*:/.test(code) ? 'package-json' : 'json';
  if (/^\s*\[package\]/m.test(code) || CARGO_HEADER.test(code)) return 'cargo';
  const trimmed = code.trimStart();
  if (trimmed.startsWith('{') && /"(?:dev)?[dD]ependencies"\s*:/.test(code)) return 'package-json';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (/^\s*(?:pub\s+)?(?:use\s+[\w:]+|fn\s+\w+|impl\b|#\[near)/m.test(code)) return 'rust';
  if (/\b(?:import|export|require\(|const|let|function|=>)\b/.test(code)) return 'js';
  return 'text';
}

/** Offsets where each line starts, for a line lookup in O(log n) per hit. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

export function lineAtOffset(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * An import is reported on the line of its module specifier, which for a
 * multi-line `import {\n a,\n} from 'x'` is the `from` line. The clause
 * between `import` and `from` is bounded: unbounded, a file of bare
 * `import` words made each one rescan the rest of the file.
 */
function jsImports(text: string): ImportRef[] {
  const starts = lineStarts(text);
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"`;]{0,800}?\s+from\s+)?(['"])([^'"\n]+)\1/g,
    /\bexport\s+(?:type\s+)?[^'"`;]{0,800}?\s+from\s+(['"])([^'"\n]+)\1/g,
    /\brequire\(\s*(['"])([^'"\n]+)\1\s*\)/g,
    /\bimport\(\s*(['"])([^'"\n]+)\1\s*\)/g,
  ];
  const out: ImportRef[] = [];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const offset = m.index! + m[0].lastIndexOf(m[2]);
      out.push({ module: m[2], line: lineAtOffset(starts, offset) });
    }
  }
  return out;
}

const RUST_NOT_A_CRATE = new Set(['crate', 'self', 'super', 'std', 'core', 'alloc']);

/**
 * `use` at a line start, after a `;` or a `{` (`use a; use b::c;`,
 * `mod m { use x::y; }`), and the first path of a braced group
 * (`use {near_sdk_sim::x, …}`). A path written out in full without `use`
 * (`near_sdk_sim::init()`) is matched by check-code's text pass.
 */
function rustImports(text: string): ImportRef[] {
  const starts = lineStarts(text);
  const out: ImportRef[] = [];
  for (const m of text.matchAll(/(?:^|[;{])[ \t]*(?:pub(?:\([^)]*\))?\s+)?use\s+(?:::)?\{?\s*([A-Za-z_]\w*)/gm)) {
    if (!RUST_NOT_A_CRATE.has(m[1])) out.push({ module: m[1], line: lineAtOffset(starts, m.index! + m[0].length - m[1].length) });
  }
  for (const m of text.matchAll(/\bextern\s+crate\s+([A-Za-z_]\w*)/g)) {
    out.push({ module: m[1], line: lineAtOffset(starts, m.index! + m[0].length - m[1].length) });
  }
  return out;
}

/** `[dependencies]`, `[dev-dependencies]`, `[target.'cfg(…)'.dependencies]`, and the one-dependency form `[dependencies.near-sdk]`. */
const DEP_HEADER = /^\[\s*(?:target\.(?:'[^']*'|"[^"]*"|[^\]]+?)\.)?(?:workspace\.)?(?:dev-|build-)?dependencies(?:\.\s*("?)([^"\]]+)\1)?\s*\]$/;

function unquoteKey(k: string): string {
  return k.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

/** Bracket depth of a TOML line outside strings, to join a multi-line inline table. */
function depthDelta(line: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\' && quote === '"') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  }
  return depth;
}

/** A top-level key of an inline table: `version = "x"` right after `{` or `,`, not inside `features = ["version = 1"]`. */
function inlineKey(table: string, key: string): string | null {
  return table.match(new RegExp(`(?:^|[{,])\\s*${key}\\s*=\\s*"([^"]*)"`))?.[1] ?? null;
}

/**
 * Cargo dependencies in every form Cargo accepts: `name = "1.2"`,
 * `"name" = "1.2"`, `name = { version = "=0.10.2", … }` over one or several
 * lines, `name.version = "4"`, `name.workspace = true`, `alias = { package =
 * "real-name", … }`, and a `[dependencies.name]` table of its own. Git, path
 * and workspace dependencies have no version requirement to check.
 */
function cargoDependencies(text: string): Dependency[] {
  const out: Dependency[] = [];
  const lines = text.split('\n');
  let inDeps = false;
  let table: { name: string; line: number; version: string | null; pkg: string | null } | null = null;
  const flush = () => {
    if (table) out.push({ registry: 'crates', name: table.pkg ?? table.name, spec: table.version, line: table.line });
    table = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('[')) {
      flush();
      const h = line.match(DEP_HEADER);
      inDeps = Boolean(h) && !h![2];
      if (h?.[2]) table = { name: unquoteKey(h[2]), line: i + 1, version: null, pkg: null };
      continue;
    }
    if (!line || (!inDeps && !table)) continue;
    const m = line.match(/^("[^"]+"|'[^']+'|[A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    const start = i;
    let depth = depthDelta(value);
    while (depth > 0 && i + 1 < lines.length) {
      i++;
      value += ' ' + lines[i].trim();
      depth += depthDelta(lines[i]);
    }
    const key = unquoteKey(m[1]);
    const str = value.match(/^"([^"]*)"/)?.[1] ?? null;
    if (table) {
      if (key === 'version') table.version = str;
      if (key === 'package') table.pkg = str;
      continue;
    }
    const dotted = key.match(/^(.+?)\.(version|workspace|package|git|path|features|optional|default-features)$/);
    if (dotted) {
      const existing = out.find((d) => d.name === dotted[1]);
      if (dotted[2] === 'version' && existing) existing.spec = str;
      else if (!existing) out.push({ registry: 'crates', name: dotted[1], spec: dotted[2] === 'version' ? str : null, line: start + 1 });
      continue;
    }
    const spec = value.startsWith('"') ? str : value.startsWith('{') ? inlineKey(value, 'version') : null;
    const pkg = value.startsWith('{') ? inlineKey(value, 'package') : null;
    out.push({ registry: 'crates', name: pkg ?? key, spec, line: start + 1 });
  }
  flush();
  return out;
}

const NPM_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

function packageJsonDependencies(code: string, problems: string[]): Dependency[] {
  let doc: unknown;
  try {
    doc = JSON.parse(code.replace(/^\uFEFF/, ''));
  } catch (e) {
    problems.push(`package.json is not valid JSON (${(e as Error).message}); its dependencies were not checked.`);
    return [];
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    problems.push('package.json is not a JSON object; its dependencies were not checked.');
    return [];
  }
  const lines = code.split('\n');
  // The line of a name inside its own section: a "near-api-js" in scripts
  // above dependencies was being reported as the dependency's line.
  const lineOf = (section: string, name: string) => {
    const from = lines.findIndex((l) => new RegExp(`"${section}"\\s*:`).test(l));
    const i = lines.findIndex((l, n) => n > from && l.includes(`"${name}"`));
    return i < 0 ? Math.max(from + 1, 1) : i + 1;
  };
  const out: Dependency[] = [];
  for (const section of NPM_SECTIONS) {
    const deps = (doc as Record<string, unknown>)[section];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
      const s = typeof spec === 'string' ? spec : null;
      const unversioned = !s || /^(?:workspace:|file:|link:|git|github:|https?:)/.test(s) || s.includes('/');
      out.push({ registry: 'npm', name, spec: unversioned ? null : s, line: lineOf(section, name) });
    }
  }
  return out;
}

export function scanCode(code: string, filename?: string, language?: Language): Scan {
  const lang = language ?? detectLanguage(code, filename);
  switch (lang) {
    case 'js': {
      const text = stripJsComments(code);
      return { language: lang, text, imports: jsImports(text), dependencies: [], problems: [] };
    }
    case 'rust': {
      const text = stripRustComments(code);
      return { language: lang, text, imports: rustImports(text), dependencies: [], problems: [] };
    }
    case 'cargo':
    case 'toml': {
      const text = stripTomlComments(code);
      return { language: lang, text, imports: [], dependencies: lang === 'cargo' ? cargoDependencies(text) : [], problems: [] };
    }
    case 'package-json': {
      const problems: string[] = [];
      return { language: lang, text: code, imports: [], dependencies: packageJsonDependencies(code, problems), problems };
    }
    case 'json':
      return { language: lang, text: stripJsComments(code), imports: [], dependencies: [], problems: [] };
    default:
      return { language: 'text', text: code, imports: [], dependencies: [], problems: [] };
  }
}

/** The npm package an import specifier resolves to: `@near-js/accounts/lib/x` -> `@near-js/accounts`. */
export function packageOfSpecifier(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? (parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null) : parts[0];
}
