/**
 * Does every stored value survive every parser the code points at its column?
 *
 * THE CLASS. A TEXT column has no format. `created_date`, `published_at`,
 * `synced_at` are names, not types, and SQLite will store anything in them.
 * The format lives in whoever wrote the row and the parser lives in whoever
 * reads it, and nothing in between compares the two. When they disagree
 * nothing throws - that is the whole defect. SQLite's date functions answer a
 * value they cannot parse with NULL. V8's Date.parse answers with NaN, or
 * worse, with a confident date after silently discarding a trailing
 * parenthesised comment. Lexicographic `<` on strings answers every time and
 * is simply wrong when the column holds two shapes.
 *
 * WHY THIS EXISTS HERE. The case that justified it: `cips.approved_date` is the
 * CIP header verbatim, and one CIP's header read "2025-06-203" - no such day.
 * formatDate's `/^(\d{4})-(\d{2})-(\d{2})/` matched the first ten characters
 * and printed a confident wrong date; formatDateShort's raw `new Date()`
 * either agreed by accident or refused. Writing this check found the exact
 * same shape bug live in lib/utils.ts - fixed alongside it, see isoDateHead
 * there.
 *
 * SCOPE. This check has seven gates, G1-G5 plus G7 and G8. G6, G9 and G10 are
 * left out because the infrastructure they assert does not exist yet, not
 * because the question is unimportant:
 *
 *   G6  write-time trigger enforcement - needs scripts/install-format-
 *       triggers.ts and guardedColumns()/triggerSql() in lib/formats.ts.
 *       Neither exists on this app. Building them is a separate unit of work.
 *   G9  three version comparators agreeing - this app has no fleet of
 *       versioned nodes and no second or third comparator to cross-check
 *       against, so there is nothing for a G9 to compare.
 *   G10 a guarded column vs SQLite's own clock - the other half of G6; this
 *       app's scattered `datetime('now')` comparisons are real but the guard
 *       G10 exists to protect (the write-time trigger) is not there either.
 *
 * G3's semver half is kept as a tripwire: there is
 * no live semver-ordered column today, so it asserts nothing yet, but it
 * fires the day one is added and ordered on text.
 *
 * TWO SIDES, TWO SOURCES, and the reason this cannot only-pass:
 *
 *   G1 completeness   schema (sqlite_master)      vs  lib/formats.ts
 *   G2 agreement      SQLite's C date parser      vs  V8's, vs this repo's own
 *   G3 ordering       text order of the values    vs  their true order
 *   G4 opacity        a declared non-date column  vs  what our formatters do to it
 *   G5 split parser   a column inside a date fn   vs  the same column outside one
 *   G7 semantics      a row's own earlier column  vs  its later one, and the clock
 *   G8 blind band     what the classifier decided vs  what it could not decide
 *
 * WHAT IT CANNOT SEE, said out loud rather than left to look like coverage:
 *
 *   - Classification needs a majority to CLASSIFY, but not to be seen: G8
 *     fails on any column where 5-50% of values look like a parseable shape.
 *     Below 5% is still unwalked, which is the honest floor for "a few stray
 *     values in prose".
 *   - G4 is date-only. For an opaque URL column the promise "nothing renders
 *     it as an href" is not something this can prove.
 *   - G5 reads SQL string literals with a regex and cannot see a nested date
 *     function, or a query assembled from fragments across statements.
 *   - A column with no data yet has no family, no gate, and (without G6) no
 *     guard at all. The empty-column count is printed on every run.
 *
 *   npx tsx scripts/check-formats.ts
 *   npx tsx scripts/check-formats.ts --verbose   # every offending value
 *   DB_PATH=/path/copy.db npx tsx scripts/check-formats.ts    # scratch copy
 */

import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import {
  EPOCH_UNITS, OPAQUE, SEMVER_RE, semverKey,
  ORDER_PAIRS, FUTURE_IS_LEGITIMATE,
  type Exception, type Format,
} from '../lib/formats';
import { isoDateHead, formatDate, formatDateShort } from '../lib/utils';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const VERBOSE = process.argv.includes('--verbose');
const SAMPLE = 5;

interface Problem { gate: string; where: string; what: string; rows: string[] }
const problems: Problem[] = [];
function fail(gate: string, where: string, what: string, rows: string[] = []) {
  problems.push({ gate, where, what, rows });
}

// ── the surface ─────────────────────────────────────────────────────────────

interface Col { table: string; column: string; declaredType: string }

/** Tables left out of the walk, and why. Reported; never silent. */
const skippedTables: string[] = [];

function allColumns(db: Database.Database): Col[] {
  const rows = db.prepare(
    `SELECT name, COALESCE(sql, '') AS sql FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  ).all() as { name: string; sql: string }[];

  const tables: string[] = [];
  for (const r of rows) {
    // FTS shadow tables mirror a real column that is checked on its own table.
    if (/_fts(_|$)/.test(r.name)) continue;
    if (/^CREATE VIRTUAL/i.test(r.sql)) { skippedTables.push(`${r.name} (virtual table; PRAGMA cannot open it)`); continue; }
    tables.push(r.name);
  }

  const out: Col[] = [];
  for (const table of tables) {
    let info: { name: string; type: string }[];
    try {
      info = db.prepare(`PRAGMA table_info("${table}")`).all() as never;
    } catch (err) {
      skippedTables.push(`${table} (PRAGMA table_info failed: ${(err as Error).message})`);
      continue;
    }
    for (const c of info) out.push({ table, column: c.name, declaredType: c.type });
  }
  return out;
}

const looksDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}([T ]|$)/.test(v);
/**
 * Starts like JSON AND parses as JSON.
 *
 * The bracket test alone is not a JSON test: a title or transcript can open
 * with a literal `[` in prose. Both conditions must hold.
 */
const looksJson = (v: unknown) => {
  if (typeof v !== 'string' || !/^\s*[[{]/.test(v)) return false;
  try { JSON.parse(v); return true; } catch { return false; }
};
const looksUrl = (v: unknown) => typeof v === 'string' && /^https?:\/\//.test(v);
const looksSemver = (v: unknown) => typeof v === 'string' && SEMVER_RE.test(v);

/**
 * What family a column belongs to, decided from the column's own values.
 *
 * The schema cannot answer this: every one of these is TEXT. A majority of a
 * 200-row sample is enough to classify; the assertions that follow then walk
 * every distinct value, because a sample is exactly what lets a minority of
 * bad rows hide inside a column that looked entirely clean.
 */
function classify(db: Database.Database, c: Col): Format | null {
  let vals: unknown[];
  try {
    vals = (db.prepare(
      `SELECT "${c.column}" v FROM "${c.table}" WHERE "${c.column}" IS NOT NULL AND "${c.column}" <> '' LIMIT 200`,
    ).all() as { v: unknown }[]).map((r) => r.v);
  } catch { return null; }
  if (!vals.length) return null;
  const frac = (p: (v: unknown) => boolean) => vals.filter(p).length / vals.length;
  if (frac(looksDate) >= 0.5) return 'date';
  if (frac(looksJson) >= 0.5) return 'json';
  if (frac(looksUrl) >= 0.5) return 'url';
  if (frac(looksSemver) >= 0.5) return 'semver';
  return null;
}

function distinct(db: Database.Database, c: Col): unknown[] {
  return (db.prepare(
    `SELECT DISTINCT "${c.column}" v FROM "${c.table}" WHERE "${c.column}" IS NOT NULL AND "${c.column}" <> ''`,
  ).all() as { v: unknown }[]).map((r) => r.v);
}

// ── G2: do the parsers agree? ───────────────────────────────────────────────

/** SQLite's julianday, converted to ms, or null when its parser refuses. */
function sqliteMs(db: Database.Database, v: string): number | null {
  const j = (db.prepare('SELECT julianday(?) j').get(v) as { j: number | null }).j;
  return j == null ? null : Math.round((j - 2440587.5) * 86_400_000);
}

/**
 * A clock with no zone designator.
 *
 * SQLite reads `2026-08-06 03:30:10` as UTC. V8 reads the same string as LOCAL
 * time. The two parsers agree on this box only because it happens to run in
 * UTC, so this is decided from the shape instead, which is true wherever the
 * check runs and wherever the value is later read.
 */
const CLOCK_WITHOUT_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/;

function checkDateAgreement(db: Database.Database, c: Col, values: unknown[]): string[] {
  const bad: string[] = [];
  for (const v of values) {
    if (typeof v !== 'string') { bad.push(`${JSON.stringify(v)} — stored as ${typeof v}, not text`); continue; }
    if (CLOCK_WITHOUT_ZONE.test(v)) {
      bad.push(`${JSON.stringify(v)} — a clock with no zone: SQLite reads it as UTC, V8 as local time`);
      continue;
    }
    const s = sqliteMs(db, v);
    const j = Date.parse(v);
    const own = isoDateHead(v);
    if (s == null && Number.isFinite(j)) {
      bad.push(`${JSON.stringify(v)} — SQLite refuses it, V8 reads it as ${new Date(j).toISOString()}`);
    } else if (s != null && !Number.isFinite(j)) {
      bad.push(`${JSON.stringify(v)} — V8 refuses it, SQLite reads it as ${new Date(s).toISOString()}`);
    } else if (s == null && !Number.isFinite(j)) {
      bad.push(`${JSON.stringify(v)} — neither parser reads it as a date`);
    } else if (Math.abs((s as number) - j) > 1000) {
      bad.push(`${JSON.stringify(v)} — SQLite ${new Date(s as number).toISOString()} vs V8 ${new Date(j).toISOString()}`);
    } else if (own == null) {
      bad.push(`${JSON.stringify(v)} — both engines parse it, isoDateHead does not`);
    }
  }
  return bad;
}

function checkJsonAgreement(db: Database.Database, values: unknown[]): string[] {
  const bad: string[] = [];
  for (const v of values) {
    if (typeof v !== 'string') { bad.push(`${JSON.stringify(v)} — stored as ${typeof v}, not text`); continue; }
    const sqliteOk = !!(db.prepare('SELECT json_valid(?) k').get(v) as { k: number }).k;
    let v8Ok = true;
    try { JSON.parse(v); } catch { v8Ok = false; }
    if (sqliteOk !== v8Ok) bad.push(`${JSON.stringify(v.slice(0, 60))} — json_valid=${sqliteOk} JSON.parse=${v8Ok}`);
    else if (!v8Ok) bad.push(`${JSON.stringify(v.slice(0, 60))} — neither parser reads it as JSON`);
  }
  return bad;
}

function checkUrlAgreement(values: unknown[]): string[] {
  const bad: string[] = [];
  for (const v of values) {
    if (typeof v !== 'string') { bad.push(`${JSON.stringify(v)} — stored as ${typeof v}, not text`); continue; }
    try { new URL(v); } catch { bad.push(`${JSON.stringify(v.slice(0, 60))} — new URL() throws`); }
  }
  return bad;
}

/** Anything before this is a clock that was never set, or a unit mistake. */
const EPOCH_FLOOR_MS = Date.parse('2015-01-01T00:00:00Z');

function checkEpoch(unit: 'epoch_ms' | 'epoch_s', values: unknown[]): string[] {
  const bad: string[] = [];
  const now = Date.now();
  for (const v of values) {
    if (typeof v !== 'number') { bad.push(`${JSON.stringify(v)} — stored as ${typeof v}, not a number`); continue; }
    const ms = unit === 'epoch_ms' ? v : v * 1000;
    if (ms < EPOCH_FLOOR_MS || ms > now + 86_400_000) {
      bad.push(`${v} — read as ${unit} that is ${new Date(ms).toISOString()}, outside [2015, now]`);
    }
  }
  return bad;
}

// ── the code side: what does the repo do with these columns? ────────────────

function sourceFiles(): string[] {
  const out: string[] = [];
  const skip = new Set(['node_modules', '.next', '.next.prev', '.next.new', '.git', '.claude', 'data', 'public', 'brain']);
  const skipFile = new Set([
    path.join(ROOT, 'scripts', 'break-formats.ts'),
    path.join(ROOT, 'scripts', 'check-formats.ts'),
  ]);
  (function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (fs.existsSync(path.join(p, '.git'))) continue; walk(p); continue; }
      if (/\.(ts|tsx)$/.test(e.name) && !skipFile.has(p)) out.push(p);
    }
  })(ROOT);
  return out;
}

/**
 * Comments blanked, keeping every newline so line numbers still point at the
 * source.
 *
 * An apostrophe in English prose opens a string as far as the scanner below
 * is concerned, and everything downstream of it is read one quote out of
 * phase until the next one closes it. The whole class of stray quotes lives
 * in prose, and prose lives in comments, so this removes the cause rather
 * than the symptom.
 */
function blankComments(src: string): string {
  const keepLines = (s: string) => s.replace(/[^\n]/g, ' ');
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out += keepLines(src.slice(i, stop));
      i = stop;
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += keepLines(src.slice(i, stop));
      i = stop;
    } else if (c === '`' || c === "'" || c === '"') {
      const q = c;
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === q) { j++; break; }
        j++;
      }
      out += src.slice(i, j);
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Every string literal in the file that reads like SQL, with its line number. */
function sqlLiterals(src: string): { sql: string; line: number }[] {
  const out: { sql: string; line: number }[] = [];
  const scanned = blankComments(src);
  const rx = /(`|'|")((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(scanned))) {
    const body = m[2];
    if (!/\b(SELECT|UPDATE|DELETE FROM|INSERT INTO)\b/i.test(body)) continue;
    out.push({ sql: body, line: scanned.slice(0, m.index).split('\n').length });
  }
  return out;
}

const DATE_FN = /\b(julianday|strftime|datetime|date|unixepoch)\s*\(([^()]*)\)/gi;

/**
 * Columns the code orders or windows on the RAW text, per G3, keyed by
 * `table.column`.
 *
 * `ORDER BY col`, `col >= ?`, `col BETWEEN ...`. A column that only ever
 * reaches SQL inside a date function is not text-ordered and is left alone.
 *
 * Qualified by which tables the statement names, because a bare column name
 * like `created_at` exists in many of them: keying on the bare name would
 * attribute an ordering in one table's query to every other table sharing the
 * column name.
 */
function textOrderedColumns(files: string[], tables: Set<string>): Map<string, string[]> {
  const hits = new Map<string, string[]>();
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    for (const { sql, line } of sqlLiterals(fs.readFileSync(f, 'utf8'))) {
      const named = new Set<string>();
      for (const m of sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+["'`]?([a-z_][a-z0-9_]*)/gi)) {
        if (tables.has(m[1])) named.add(m[1]);
      }
      if (!named.size) continue;
      const add = (col: string) => {
        for (const t of named) {
          const k = `${t}.${col.toLowerCase()}`;
          if (!hits.has(k)) hits.set(k, []);
          if (!hits.get(k)!.includes(`${rel}:${line}`)) hits.get(k)!.push(`${rel}:${line}`);
        }
      };
      const bare = sql.replace(DATE_FN, ' ');
      for (const m of bare.matchAll(/\bORDER\s+BY\s+([a-z_][a-z0-9_]*)/gi)) add(m[1]);
      for (const m of bare.matchAll(/,\s*([a-z_][a-z0-9_]*)\s+(?:ASC|DESC)\b/gi)) add(m[1]);
      for (const m of bare.matchAll(/\b([a-z_][a-z0-9_]*)\s*(?:>=|<=|>|<)\s*[?'"]/gi)) add(m[1]);
      for (const m of bare.matchAll(/\b([a-z_][a-z0-9_]*)\s+BETWEEN\b/gi)) add(m[1]);
    }
  }
  return hits;
}

/**
 * G5. One statement that reads one column through two different parsers.
 *
 * The shape this catches: `julianday(col)` in the projection and a bare
 * `col > other_col` in the WHERE of the same statement. Both run, neither
 * errors, and the two halves of one SELECT disagree about which rows exist.
 *
 * `dateCols` is every text column that carries dates INCLUDING declared-opaque
 * ones, because that is exactly where this bites: a column classified opaque
 * because its shape is unreliable is precisely the one a split read hurts
 * most, and a check that only walked `classified === 'date'` columns would
 * miss the case it exists for.
 */
function splitParserStatements(files: string[], dateCols: Set<string>): string[] {
  const out: string[] = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    for (const { sql, line } of sqlLiterals(fs.readFileSync(f, 'utf8'))) {
      const wrapped = new Set<string>();
      for (const m of sql.matchAll(DATE_FN)) {
        for (const id of m[2].matchAll(/\b([a-z_][a-z0-9_]*)\b/gi)) {
          if (dateCols.has(id[1].toLowerCase())) wrapped.add(id[1].toLowerCase());
        }
      }
      if (!wrapped.size) continue;
      // A bare comparison whose BOUNDARY is generated in the stored shape via
      // isoNowSql()/isoDayStartSql() is the idiom this repo prescribes, not
      // the defect this gate looks for - two parsers DISAGREEING, not two
      // spellings of one. Narrow on purpose: only where the right-hand side is
      // one of those two helpers.
      const bare = sql.replace(DATE_FN, ' ').replace(/\$\{\s*iso(?:Now|DayStart)Sql\s*\([^}]*\}/g, ' @BOUNDARY ');
      for (const col of wrapped) {
        const rx = new RegExp(`\\b${col}\\b\\s*(?:[<>=!]+|\\bBETWEEN\\b)\\s*(\\S+)`, 'gi');
        const rhs = [...bare.matchAll(rx)].map(m2 => m2[1]);
        if (rhs.some(r => r !== '@BOUNDARY')) out.push(`${rel}:${line} — ${col} is read through a date function and compared as text in the same statement`);
      }
    }
  }
  return out;
}

// ── main ────────────────────────────────────────────────────────────────────

function main() {
  const db = getDb();
  const cols = allColumns(db);
  const tables = new Set(cols.map((c) => c.table));
  const key = (c: Col) => `${c.table}.${c.column}`;

  const exceptions = new Map<string, Exception>();
  for (const e of [...OPAQUE, ...EPOCH_UNITS]) exceptions.set(`${e.table}.${e.column}`, e);

  // Declarations that no longer describe anything real are worse than absent:
  // they read as coverage.
  for (const [k, e] of exceptions) {
    const [t, c] = [e.table, e.column];
    if (!tables.has(t) || !cols.some((x) => x.table === t && x.column === c)) {
      fail('G1', k, 'declared in lib/formats.ts but no such column exists');
    }
  }

  // ── G8: the band the classifier cannot see ───────────────────────────────
  const BAND_LO = 0.05, BAND_HI = 0.5;
  const declaredKeys = new Set([...OPAQUE, ...EPOCH_UNITS].map((e) => `${e.table}.${e.column}`));
  for (const c of cols) {
    if (declaredKeys.has(key(c))) continue;
    let sample: unknown[];
    try {
      sample = (db.prepare(
        `SELECT "${c.column}" v FROM "${c.table}" WHERE "${c.column}" IS NOT NULL AND "${c.column}" <> '' LIMIT 300`,
      ).all() as { v: unknown }[]).map((r) => r.v);
    } catch { continue; }
    if (!sample.length) continue;
    for (const [name, p] of [['date', looksDate], ['json', looksJson], ['url', looksUrl]] as const) {
      const f = sample.filter(p).length / sample.length;
      if (f >= BAND_LO && f < BAND_HI) {
        fail('G8', key(c),
          `${(f * 100).toFixed(0)}% of sampled values look like ${name}, which is a minority — too few to classify and too many to ignore`,
          ['Declare it in lib/formats.ts (opaque, with the reader that makes it safe), or fix the column.']);
      }
    }
  }

  const classified = new Map<string, Format>();
  for (const c of cols) {
    const declared = exceptions.get(key(c));
    if (declared?.format === 'opaque') { classified.set(key(c), 'opaque'); continue; }
    if (declared) { classified.set(key(c), declared.format); continue; }
    const f = classify(db, c);
    if (f) classified.set(key(c), f);
  }

  let emptyCols = 0;
  for (const c of cols) {
    try {
      const n = (db.prepare(`SELECT COUNT(*) n FROM "${c.table}" WHERE "${c.column}" IS NOT NULL AND "${c.column}" <> ''`).get() as { n: number }).n;
      if (n === 0) emptyCols++;
    } catch { /* virtual or unreadable */ }
  }

  const counts: Record<string, number> = { date: 0, json: 0, url: 0, epoch_ms: 0, epoch_s: 0, semver: 0, opaque: 0 };
  for (const f of classified.values()) counts[f]++;

  const dateColNames = new Set<string>();
  for (const c of cols) {
    const f = classified.get(key(c));
    if (f === 'date') dateColNames.add(c.column.toLowerCase());
    else if (f === 'opaque' && distinct(db, c).some(looksDate)) dateColNames.add(c.column.toLowerCase());
  }

  // ── G2: every value, every parser of its family ──────────────────────────
  let valuesWalked = 0;
  for (const c of cols) {
    const f = classified.get(key(c));
    if (!f || f === 'opaque') continue;
    const values = distinct(db, c);
    valuesWalked += values.length;
    let bad: string[] = [];
    if (f === 'date') bad = checkDateAgreement(db, c, values);
    else if (f === 'json') bad = checkJsonAgreement(db, values);
    else if (f === 'url') bad = checkUrlAgreement(values);
    else if (f === 'epoch_ms' || f === 'epoch_s') bad = checkEpoch(f, values);
    // semver has no value-level gate, deliberately: a mixed shape only hurts
    // when something ORDERS the column, and that is G3's question.
    if (bad.length) {
      fail('G2', key(c), `${bad.length} of ${values.length} distinct value(s) the ${f} parsers disagree on`, bad);
    }
  }

  // ── G3: text order vs true order, where the code orders on text ──────────
  const files = sourceFiles();
  const ordered = textOrderedColumns(files, tables);
  let orderChecked = 0;
  for (const c of cols) {
    const fam = classified.get(key(c));
    if (fam !== 'date' && fam !== 'semver') continue;
    const at = ordered.get(key(c).toLowerCase());
    if (!at) continue;
    orderChecked++;
    const values = distinct(db, c).filter((v): v is string => typeof v === 'string');
    const lex = [...values].sort();
    const trueOrder = [...values].sort((a, b) => {
      let d = 0;
      if (fam === 'semver') {
        const ka = semverKey(a), kb = semverKey(b);
        for (let i = 0; i < 3; i++) if ((ka[i] ?? 0) !== (kb[i] ?? 0)) { d = (ka[i] ?? 0) - (kb[i] ?? 0); break; }
      } else {
        const ta = sqliteMs(db, a) ?? Date.parse(a);
        const tb = sqliteMs(db, b) ?? Date.parse(b);
        if (Number.isFinite(ta) && Number.isFinite(tb)) d = ta - tb;
      }
      if (d !== 0) return d;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const at0 = lex.findIndex((v, i) => v !== trueOrder[i]);
    if (at0 >= 0) {
      fail('G3', key(c),
        `text order and ${fam === 'semver' ? 'version' : 'time'} order disagree, and the code sorts on the text (${at.join(', ')})`,
        [`position ${at0}: as text ${JSON.stringify(lex[at0])}, by ${fam === 'semver' ? 'version' : 'date'} ${JSON.stringify(trueOrder[at0])}`]);
    }
  }

  // ── G4: an opaque column must not be rendered as a date ──────────────────
  let opaqueValues = 0;
  for (const c of cols) {
    if (classified.get(key(c)) !== 'opaque') continue;
    const values = distinct(db, c).filter((v): v is string => typeof v === 'string');
    if (!values.some(looksDate)) continue;
    opaqueValues += values.length;
    const bad: string[] = [];
    for (const v of values) {
      if (isoDateHead(v)) continue; // it really is a date; rendering it as one is right
      for (const [name, fn] of [['formatDate', formatDate], ['formatDateShort', formatDateShort]] as const) {
        const out = fn(v);
        if (out !== v) bad.push(`${JSON.stringify(v)} — ${name}() turns it into ${JSON.stringify(out)}`);
      }
    }
    if (bad.length) fail('G4', key(c), `${bad.length} rendering(s) of a value that is not a date`, bad);
  }

  // ── G5: two parsers for one column inside one statement ──────────────────
  for (const s of splitParserStatements(files, dateColNames)) fail('G5', s.split(' — ')[0], s.split(' — ')[1]);

  // ── G7: the shape can be right and the instant still wrong ───────────────
  let pairsChecked = 0;
  for (const table of tables) {
    const names = cols.filter((c) => c.table === table).map((c) => c.column);
    for (const [a, b] of ORDER_PAIRS) {
      if (!names.includes(a) || !names.includes(b)) continue;
      if (classified.get(`${table}.${a}`) !== 'date' || classified.get(`${table}.${b}`) !== 'date') continue;
      pairsChecked++;
      const rows = db.prepare(
        `SELECT "${a}" x, "${b}" y FROM "${table}"
         WHERE "${a}" IS NOT NULL AND "${b}" IS NOT NULL AND "${a}" <> '' AND "${b}" <> ''
           AND julianday("${a}") > julianday("${b}") LIMIT 20`,
      ).all() as { x: string; y: string }[];
      if (rows.length) {
        fail('G7', `${table}.${a} > ${table}.${b}`,
          `${rows.length}${rows.length === 20 ? '+' : ''} row(s) where ${a} is after ${b}`,
          rows.map((r) => `${r.x} > ${r.y}`));
      }
    }
  }

  let futureChecked = 0;
  for (const c of cols) {
    if (classified.get(key(c)) !== 'date') continue;
    if (FUTURE_IS_LEGITIMATE.test(c.column)) continue;
    futureChecked++;
    const rows = db.prepare(
      `SELECT DISTINCT "${c.column}" v FROM "${c.table}"
       WHERE julianday("${c.column}") > julianday('now','+1 day') LIMIT 20`,
    ).all() as { v: string }[];
    if (rows.length) {
      fail('G7', key(c), `${rows.length}${rows.length === 20 ? '+' : ''} value(s) dated in the future`,
        rows.map((r) => r.v));
    }
  }

  // ── report ───────────────────────────────────────────────────────────────
  console.log(`tables walked:            ${tables.size} (non-FTS)`);
  for (const s of skippedTables) console.log(`  not walked:             ${s}`);
  console.log(`columns walked:           ${cols.length}`);
  console.log(`  carrying a format:      ${classified.size}`);
  console.log(`    date:                 ${counts.date}`);
  console.log(`    json:                 ${counts.json}`);
  console.log(`    url:                  ${counts.url}`);
  console.log(`    semver:               ${counts.semver}`);
  console.log(`    epoch (declared):     ${counts.epoch_ms + counts.epoch_s}`);
  console.log(`    opaque (declared):    ${counts.opaque}`);
  console.log(`distinct values parsed:   ${valuesWalked + opaqueValues}`);
  console.log(`date/semver columns the code orders on text: ${orderChecked}`);
  console.log(`self-contradiction pairs asserted: ${pairsChecked} column pair(s), ${futureChecked} column(s) checked for future dates`);
  console.log(`columns with no data yet, so unclassified: ${emptyCols}`);
  console.log(`source files read for SQL: ${files.length}`);
  console.log(`gates not covered (need infra this app does not have yet): G6 write-time triggers, G9 version comparators, G10 clock-shape comparisons`);

  for (const p of problems) {
    console.error(`\n[${p.gate}] ${p.where}: ${p.what}`);
    for (const r of p.rows.slice(0, VERBOSE ? p.rows.length : SAMPLE)) console.error(`    ${r}`);
    if (!VERBOSE && p.rows.length > SAMPLE) console.error(`    ... ${p.rows.length - SAMPLE} more (--verbose)`);
  }

  logRun('check-formats', {
    status: problems.length ? 'partial' : 'success',
    items: cols.length,
    error: problems.length ? problems.map((p) => `${p.gate} ${p.where}: ${p.what}`).join(' ; ').slice(0, 1000) : undefined,
  }, db);

  if (problems.length) {
    console.error(`\ncheck-formats: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log('\ncheck-formats: every stored value survives every parser its column is read with');
}

main();
