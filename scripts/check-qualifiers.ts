/**
 * A qualifier in the sentence must exist in the query.
 *
 * WHY. Tool output is prose with numbers in it, and the prose carries
 * qualifiers: "N of M", "matching", "with no reply". Every one of those
 * words is a claim about which rows were counted. Nothing compares the claim
 * to the WHERE clause.
 *
 * Writing it found the
 * mechanical sweep's own flagship shape (G1: a count rendered from an array
 * a LIMIT filled, without saying so) was exactly what check-published-totals
 * fixed the day before this - list_ecosystem_projects/
 * list_github_discussions printed the page size as if it were the total.
 * Those now say "showing N of M", so the sweep sees them clean; this
 * exists to keep it that way and to reach every OTHER tool that could grow
 * the same shape tomorrow.
 *
 * WHAT IS DECLARED. No claims today: the type and the walk stay so the next
 * qualifier a tool prints can be declared in one entry. list_ecosystem_projects
 * never renders a liveness sentence
 * ("N have not answered the probe"): liveness is written by check-ecosystem-
 * liveness.ts and read by the web UI, never by an MCP tool (grep confirms
 * zero mentions in mcp-server.ts).
 *
 * The mechanical sweeps (G1, G2) are fully generic: they walk mcp-server.ts and lib/*.ts rather than a hand list, so a new
 * tool is inside their surface the day it is written.
 *
 *   npx tsx scripts/check-qualifiers.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/**
 * The SQL below is a COPY of the SQL inside the tool, and a copy with nothing
 * comparing it to the original is the defect check-concepts exists to catch.
 *
 * So every claim names a fragment of the serving code it was derived from.
 * Edit the tool's query and the fragment stops matching, which fails the
 * claim with "derived from code that has changed" rather than leaving it
 * quietly grading an implementation that no longer runs.
 */
interface Provenance {
  file: string;
  fragment: string;
}

/**
 * A filter whose name promises it leaves rows out.
 *
 * Fails when the filter keeps everything (vacuous) and when it keeps nothing
 * (a live filter over an empty result is indistinguishable from a broken
 * one, and the corpus is not empty).
 */
interface SubsetClaim {
  kind: 'subset';
  tool: string;
  from: Provenance | { exempt: string };
  /** The words the tool prints over the number. */
  claim: string;
  /** Rows the qualifier is supposed to select. */
  subset: string;
  /** Rows it selects from. */
  population: string;
  why: string;
}

type Claim = SubsetClaim;

const CLAIMS: Claim[] = [
];

function scalar(db: ReturnType<typeof getDb>, sql: string, params: unknown[] = []): number {
  const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
  if (!row) return 0;
  const v = Object.values(row)[0];
  return typeof v === 'number' ? v : Number(v ?? 0);
}

const sourceCache = new Map<string, string>();
function source(file: string): string {
  if (!sourceCache.has(file)) sourceCache.set(file, fs.readFileSync(path.join(ROOT, file), 'utf8'));
  return sourceCache.get(file)!;
}

/** Returns a problem string when the claim no longer describes live code. */
function provenanceProblem(c: Claim): string | null {
  if ('exempt' in c.from) return null;
  let text: string;
  try {
    text = source(c.from.file);
  } catch (err) {
    return `${c.tool} "${c.claim}": cannot read ${c.from.file} to confirm the claim still describes live code (${(err as Error).message.slice(0, 60)})`;
  }
  if (!text.includes(c.from.fragment)) {
    return `${c.tool} "${c.claim}": derived from ${c.from.file}, which no longer contains \`${c.from.fragment.replace(/\s+/g, ' ').slice(0, 70)}\` — the query moved and this claim is grading a copy of it`;
  }
  return null;
}

/**
 * Blank out comments so a comment quoting the OLD query is not read as code.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src[i] === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      const end = nl === -1 ? src.length : nl;
      out += ' '.repeat(end - i);
      i = end;
    } else if (src[i] === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close === -1 ? src.length : close + 2;
      out += src.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

/**
 * The declared claim above is the instance somebody NOTICED. Two shapes of
 * this class can be found mechanically instead, and those walk a countable
 * surface — every tool in the server, not a hand list.
 *
 *   G1  a count rendered from an array a LIMIT filled, without saying so.
 *   G2  a single-table GROUP BY over columns that are already unique in that
 *       table. The grouping is a no-op, and any HAVING COUNT(*) hung off it
 *       is vacuous. Only single-table: with a JOIN, grouping by one side's
 *       key is the normal way to collapse the fan-out.
 */
function sweepSource(db: ReturnType<typeof getDb>, problems: string[]): { g1: number; g2: number } {
  const server = stripComments(source('mcp-server.ts'));

  // G1, scoped per tool registration: `rows` in one tool is not `rows` in
  // another, and resolving names across the whole file pointed every hit at
  // the last declaration in it.
  const starts = [...server.matchAll(/^server\.tool\(\s*'([a-z0-9_]+)'/gim)].map((m) => ({ name: m[1], at: m.index! }));
  let g1 = 0;
  for (let b = 0; b < starts.length; b++) {
    const block = server.slice(starts[b].at, b + 1 < starts.length ? starts[b + 1].at : server.length);
    const baseLine = server.slice(0, starts[b].at).split('\n').length;
    const capped = new Map<string, string>();
    const record = (name: string, sql: string) => {
      const lim = /\bLIMIT\s+([^\s)]+)/i.exec(sql);
      if (!lim || /^1$/.test(lim[1])) return;   // LIMIT 1 is a .get(), not a page
      capped.set(name, lim[1]);
    };
    for (const m of block.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*?)?=[\s\S]{0,400}?db\.prepare\(\s*([`'"])([\s\S]*?)\2/g)) record(m[1], m[3]);
    for (const m of block.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*=[\s\S]{0,400}?db\.prepare\(\s*([`'"])([\s\S]*?)\2/gm)) record(m[1], m[3]);

    const blockLines = block.split('\n');
    for (let i = 0; i < blockLines.length; i++) {
      for (const p of blockLines[i].matchAll(/\$\{([A-Za-z_$][\w$]*)\.length\}/g)) {
        const lim = capped.get(p[1]);
        if (!lim) continue;
        g1++;
        // showingOf() renders "showing N of T"; a literal "showing" or an
        // adjacent "of ${total}" is the same disclosure written by hand.
        if (/showing/i.test(blockLines[i]) || /of \$\{/.test(blockLines[i])) continue;
        problems.push(
          `${starts[b].name} (mcp-server.ts:${baseLine + i}): prints \${${p[1]}.length} as a count, but ${p[1]} holds at most LIMIT ${lim} rows — that is the cap, not the total. Use showingOf(shown, countMatching(...))`,
        );
      }
    }
  }

  // G2, over the server and every lib the server calls.
  const uniqueSets = new Map<string, string[][]>();
  for (const t of db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>) {
    const sets: string[][] = [];
    try {
      const pk = (db.prepare(`PRAGMA table_info("${t.name}")`).all() as Array<{ name: string; pk: number }>)
        .filter((c) => c.pk > 0).map((c) => c.name.toLowerCase());
      if (pk.length) sets.push(pk);
      for (const i of db.prepare(`PRAGMA index_list("${t.name}")`).all() as Array<{ name: string; unique: number }>) {
        if (!i.unique) continue;
        const names = (db.prepare(`PRAGMA index_info("${i.name}")`).all() as Array<{ name: string | null }>)
          .map((c) => (c.name ?? '').toLowerCase()).filter(Boolean);
        if (names.length) sets.push(names);
      }
    } catch { /* a virtual table has no usable PRAGMA here */ }
    if (sets.length) uniqueSets.set(t.name.toLowerCase(), sets);
  }

  const libDir = path.join(ROOT, 'lib');
  const files = ['mcp-server.ts', ...fs.readdirSync(libDir).filter((f) => f.endsWith('.ts')).map((f) => `lib/${f}`)];
  let g2 = 0;
  for (const rel of files) {
    const text = stripComments(source(rel));
    for (const m of text.matchAll(/[`'"]([^`'"]*\bFROM\b[^`'"]*)[`'"]/gi)) {
      const sql = m[1].replace(/\s+/g, ' ');
      for (const g of sql.matchAll(/\bGROUP\s+BY\s+([a-z0-9_., ]+?)(?:\s+HAVING|\s+ORDER|\s+LIMIT|\s*\)|$)/gi)) {
        const before = sql.slice(0, g.index);
        const lastFrom = [...before.matchAll(/\bFROM\s+"?([a-z_][a-z0-9_]*)"?/gi)].pop();
        if (!lastFrom) continue;
        // A JOIN between that FROM and this GROUP BY means the grouping is
        // collapsing a fan-out, which is the normal reason to write one.
        if (/\bJOIN\b/i.test(before.slice(lastFrom.index))) continue;
        const table = lastFrom[1].toLowerCase();
        const sets = uniqueSets.get(table);
        if (!sets) continue;
        const bare = g[1].split(',').map((c) => c.trim().toLowerCase()).map((c) => (c.includes('.') ? c.split('.')[1] : c)).filter(Boolean);
        if (!sets.some((s) => s.every((k) => bare.includes(k)))) continue;
        g2++;
        const having = /HAVING\s*$/i.test(g[0]);
        problems.push(
          `${rel}:${text.slice(0, m.index).split('\n').length}: GROUP BY (${bare.join(', ')}) on ${table}, which is already unique on those columns` +
          (having
            ? ' — every group holds one row, so the HAVING is true for every row and filters nothing'
            : ' — the grouping is a no-op') +
          `: ${sql.slice(0, 90)}`,
        );
      }
    }
  }
  return { g1, g2 };
}

function main(): void {
  const db = getDb();
  const problems: string[] = [];
  let checked = 0;
  let exempt = 0;

  for (const c of CLAIMS) {
    checked++;
    if ('exempt' in c.from) exempt++;
    const stale = provenanceProblem(c);
    if (stale) {
      problems.push(stale);
      continue;
    }
    try {
      const sub = scalar(db, c.subset);
      const pop = scalar(db, c.population);
      if (pop === 0) {
        problems.push(`${c.tool} "${c.claim}": the population is empty, so the filter cannot be graded`);
        continue;
      }
      if (sub === pop) {
        problems.push(
          `${c.tool} "${c.claim}": the filter selects ${sub} of ${pop} — it excludes nothing, so the qualifier is not in the query (${c.why})`,
        );
      } else if (sub === 0) {
        problems.push(
          `${c.tool} "${c.claim}": the filter selects 0 of ${pop} — a section that can never appear reads the same as a gap that does not exist (${c.why})`,
        );
      } else {
        console.log(`  ok      ${c.tool.padEnd(24)} ${String(sub).padStart(6)} of ${String(pop).padEnd(6)} ${c.claim.slice(0, 46)}`);
      }
    } catch (err) {
      problems.push(`${c.tool} "${c.claim}": cannot be graded (${(err as Error).message.slice(0, 80)})`);
    }
  }

  const declaredProblems = problems.length;
  const swept = sweepSource(db, problems);
  const sweepProblems = problems.length - declaredProblems;
  console.log(
    `  swept   ${swept.g1} count(s) rendered from a capped query, ${swept.g2} single-table grouping(s) over a unique key, ${sweepProblems} problem(s)`,
  );

  console.log(
    `[check-qualifiers] ${checked} declared claim(s) graded against the query behind them` +
    `, ${checked - exempt} anchored to live source, ${exempt} exempt with a reason` +
    `; source swept for 2 mechanical shapes across every tool; ${problems.length} problem(s)`,
  );
  for (const p of problems) console.error(`  BROKEN  ${p}`);
  if (problems.length) {
    console.error('  the words above a number are a claim about which rows it counted; a filter that excludes nothing is not a filter');
  }

  logRun('check-qualifiers', {
    status: problems.length ? 'partial' : 'success',
    items: checked,
    error: problems.length ? problems.join(' ; ').slice(0, 1000) : undefined,
  }, db);

  if (problems.length) process.exitCode = 1;
}

main();
