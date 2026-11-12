/**
 * Is every tool that requires an identifier reachable at all?
 *
 * The mechanism is fully behavioural and reads nothing NEAR-specific.
 * Only COVERED_BY_HANDOFFS is app-specific: each entry names a pair that
 * check-handoffs proves round-trips, and must point at one.
 *
 * THE GAP THIS FILLS. check-handoffs proves that a DECLARED pair works: the
 * listing prints an id and the getter takes it. Its list of pairs is
 * discovered by reading mcp-server.ts for phrasings, written by hand. An
 * author who documents the same relationship in different words adds a
 * tool that nothing can reach and passes every check in the repo.
 *
 * So this asks the same question without reading a word of prose. A
 * parameter is an identifier if it BEHAVES like one, and a tool is
 * reachable if some other tool prints a value the database says is real.
 *
 * HOW A PARAMETER IS CLASSIFIED, by behaviour and nothing else:
 *
 *   1. Two values that do not exist, to learn what this parameter's
 *      refusal looks like. For integers they must also be PLAUSIBLE - see
 *      plausibleAbsentIntegers.
 *   2. One real value from every column the schema says identifies a row -
 *      every primary key and every single-column unique index, on tables
 *      mcp-server.ts actually names.
 *   3. Count how many of those the parameter ACCEPTS. An identifier
 *      accepts the one column it keys on and refuses the rest; free text
 *      accepts nearly everything.
 *
 * A parameter that accepts nothing at all is reported as unclassified, not
 * as a defect: it may key on something this database does not hold, and a
 * check that guesses in that situation is a check that cries wolf.
 *
 * THEN THE ACTUAL QUESTION. For each identifier, every tool that needs no
 * arguments is called once, and its answer is mined for tokens. If any
 * token exists in that column, the identifier is obtainable. If none does,
 * the tool is reachable only by a caller who already knows the id, which
 * for a corpus lookup means not reachable.
 *
 * Runs against a VACUUM INTO copy served by its own MCP instance, so it
 * spends none of prod's limiter and touches no live data.
 *
 *   npx tsx scripts/check-reachable.ts [--verbose]
 */

import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { repoPath } from '../lib/repo-root';
import {
  IMPOSSIBLE_A, IMPOSSIBLE_B, learnRefusal, looksLikeRefusal, startScratchMcp, tokens,
} from '../lib/mcp-probe';
import fs from 'node:fs';

const VERBOSE = process.argv.includes('--verbose');
const RUN_DEADLINE_MS = 12 * 60 * 1000;
const startedAt = Date.now();

/**
 * Above this share of candidate columns accepted, a parameter is free text
 * rather than an identifier. The threshold was measured against a large tool
 * set and is kept as-is rather than re-derived without an equivalently large
 * known-good/known-bad sample to calibrate against.
 */
const FREE_TEXT_SHARE = 0.25;

function plausibleAbsentIntegers(db: import('better-sqlite3').Database, cols: Column[]): [number, number] {
  const taken = new Set<number>();
  for (const c of cols) {
    if (!isNumeric(c.type)) continue;
    try {
      for (const r of db.prepare(
        `SELECT "${c.column}" v FROM "${c.table}" WHERE "${c.column}" BETWEEN 1 AND 400`,
      ).all() as { v: number }[]) taken.add(Number(r.v));
    } catch { /* unreadable table proves nothing */ }
  }
  const free: number[] = [];
  for (let n = 3; n <= 400 && free.length < 2; n++) if (!taken.has(n)) free.push(n);
  return free.length === 2 ? [free[0], free[1]] : [999999991, 888888882];
}

interface Column { table: string; column: string; type: string }

function identifierColumns(db: import('better-sqlite3').Database): Column[] {
  const src = fs.readFileSync(repoPath('mcp-server.ts'), 'utf-8');
  const tables = (db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
      AND name NOT LIKE '%\\_fts%' ESCAPE '\\'
      AND COALESCE(sql, '') NOT LIKE 'CREATE VIRTUAL%'
  `).all() as { name: string }[]).map(r => r.name);

  const found = new Map<string, Column>();
  for (const table of tables) {
    if (!new RegExp(`\\b${table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(src)) continue;
    const info = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; type: string; pk: number }[];
    const typeOf = new Map(info.map(c => [c.name, c.type || 'TEXT']));
    for (const c of info) {
      if (c.pk > 0) found.set(`${table}.${c.name}`, { table, column: c.name, type: c.type || 'TEXT' });
    }
    for (const idx of db.prepare(`PRAGMA index_list("${table}")`).all() as { name: string; unique: number }[]) {
      if (!idx.unique) continue;
      const cols = (db.prepare(`PRAGMA index_info("${idx.name}")`).all() as { name: string }[]).map(r => r.name);
      if (cols.length !== 1) continue;
      const t = typeOf.get(cols[0]);
      if (t) found.set(`${table}.${cols[0]}`, { table, column: cols[0], type: t });
    }
  }
  return [...found.values()].sort((a, b) => `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`));
}

const isNumeric = (t: string) => /INT/i.test(t);
const quotes = (answer: string, value: string | number) => answer.includes(String(value));

/**
 * Parameters this probe structurally cannot classify, each answered
 * elsewhere. Empty here (see file header) - kept as a typed constant, not
 * deleted, so a future multi-arg tool with a real unique-column parameter
 * has an obvious place to be declared, with the check-handoffs pair it
 * points at proven to exist by assertCoveredElsewhere below.
 */
const COVERED_BY_HANDOFFS: Record<string, string> = {
  'get_discussion.topic': 'search prints topic numbers get_discussion accepts; topic numbers overlap release ids in value, which is why the classifier above files it under github_releases.id',
  'get_doc.id': 'search and semantic_search print get_doc(<id>); doc ids overlap release ids in value',
  'resolve_package.package': 'check_code prints the package names it reads from a package.json or Cargo.toml, and a caller already holds the name of a package it depends on',
};

function handoffPairs(): Set<string> {
  const src = fs.readFileSync(repoPath('scripts', 'check-handoffs.ts'), 'utf-8');
  const out = new Set<string>();
  for (const m of src.matchAll(/consumer:\s*'([a-z_]+)',\s*param:\s*'([a-z_]+)'/g)) out.add(`${m[1]}.${m[2]}`);
  for (const m of src.matchAll(/consumer:\s*'([a-z_]+)',\s*\n?\s*param:\s*'([a-z_]+)'/g)) out.add(`${m[1]}.${m[2]}`);
  return out;
}

function assertCoveredElsewhere(problems: string[]): void {
  const declared = handoffPairs();
  for (const key of Object.keys(COVERED_BY_HANDOFFS)) {
    if (!declared.has(key)) {
      problems.push(
        `${key} is declared covered by check-handoffs, and check-handoffs declares no pair for it — `
        + 'the declaration points at nothing; add the pair there or remove it from COVERED_BY_HANDOFFS here',
      );
    }
  }
}

interface Schema {
  properties: Record<string, { type?: string; enum?: unknown[] }>;
  required: string[];
}

async function main(): Promise<void> {
  const problems: string[] = [];
  const notes: string[] = [];
  const freeText: string[] = [];
  const coveredElsewhere: string[] = [];
  assertCoveredElsewhere(problems);
  const mcp = await startScratchMcp({ label: 'check-reachable' });
  let examined = 0;

  try {
    const listed = await mcp.rpc('tools/list', {}) as {
      result?: { tools?: Array<{ name: string; inputSchema?: { properties?: Record<string, { type?: string; enum?: unknown[] }>; required?: string[] } }> };
    };
    const tools = new Map<string, Schema>();
    for (const t of listed.result?.tools ?? []) {
      tools.set(t.name, { properties: t.inputSchema?.properties ?? {}, required: t.inputSchema?.required ?? [] });
    }

    const columns = identifierColumns(mcp.snapshot);
    const sample = new Map<string, string>();
    for (const c of columns) {
      try {
        const row = mcp.snapshot.prepare(
          `SELECT "${c.column}" v FROM "${c.table}" WHERE "${c.column}" IS NOT NULL LIMIT 1`,
        ).get() as { v: unknown } | undefined;
        if (row?.v !== undefined && row.v !== null && String(row.v) !== '') sample.set(`${c.table}.${c.column}`, String(row.v));
      } catch { /* a table that will not read is not this check's finding */ }
    }
    const usable = columns.filter(c => sample.has(`${c.table}.${c.column}`));
    const [absentA, absentB] = plausibleAbsentIntegers(mcp.snapshot, usable);

    const producerOutput = new Map<string, string>();
    for (const [name, s] of tools) {
      if (s.required.length) continue;
      producerOutput.set(name, await mcp.callTool(name, {}));
    }

    const producedIn = (c: Column): string | null => {
      const stmt = mcp.snapshot.prepare(`SELECT 1 FROM "${c.table}" WHERE "${c.column}" = ? LIMIT 1`);
      for (const [producer, text] of producerOutput) {
        if (text.startsWith(' rpc-error:')) continue;
        for (const t of tokens(text)) {
          try { if (stmt.get(t)) return producer; } catch { /* type mismatch is a no */ }
        }
      }
      return null;
    };

    for (const [tool, s] of [...tools].sort((a, b) => a[0].localeCompare(b[0]))) {
      for (const param of s.required) {
        if (Date.now() - startedAt > RUN_DEADLINE_MS) {
          problems.push(`ran out of time after ${examined} parameter(s); the rest were not examined`);
          break;
        }
        const spec = s.properties[param] ?? {};
        if (spec.enum) continue;
        const numeric = spec.type === 'number' || spec.type === 'integer';
        const send = (v: string) => ({ [param]: numeric ? Number(v) : v });

        const valueA = numeric ? absentA : IMPOSSIBLE_A;
        const valueB = numeric ? absentB : IMPOSSIBLE_B;
        const answerA = await mcp.callTool(tool, { [param]: valueA });
        const answerB = await mcp.callTool(tool, { [param]: valueB });
        const refusal = learnRefusal(answerA, answerB);
        if (refusal.exact === null && !refusal.prefix && !refusal.suffix) {
          notes.push(`${tool}.${param}: two impossible values produced answers with nothing in common, so acceptance cannot be read`);
          continue;
        }
        if (refusal.exact === null && !(quotes(answerA, valueA) && quotes(answerB, valueB))) {
          notes.push(`${tool}.${param}: two impossible values got different answers that do not quote them back, so they were answered, not refused`);
          examined++;
          continue;
        }

        const probed = usable.filter(c => isNumeric(c.type) === numeric);
        if (!probed.length) continue;
        const accepted: Column[] = [];
        for (const c of probed) {
          const v = sample.get(`${c.table}.${c.column}`) as string;
          if (numeric && !/^\d+$/.test(v)) continue;
          const answer = await mcp.callTool(tool, send(v));
          if (answer.startsWith(' rpc-error:')) continue;
          if (!looksLikeRefusal(answer, refusal)) accepted.push(c);
        }
        examined++;

        const share = accepted.length / probed.length;
        if (VERBOSE) {
          console.log(`  ${tool}.${param}: accepts ${accepted.length}/${probed.length} (${(share * 100).toFixed(0)}%)`
            + (accepted.length && accepted.length <= 3 ? ` — ${accepted.map(c => `${c.table}.${c.column}`).join(', ')}` : ''));
        }
        const covered = COVERED_BY_HANDOFFS[`${tool}.${param}`];
        if (covered) { coveredElsewhere.push(`${tool}.${param} (${covered})`); continue; }
        if (accepted.length === 0) {
          notes.push(`${tool}.${param}: no identifier column in this database produced a value it accepts`);
          continue;
        }
        if (share > FREE_TEXT_SHARE) { freeText.push(`${tool}.${param} (${(share * 100).toFixed(0)}%)`); continue; }

        const reachable = accepted.map(c => ({ c, by: producedIn(c) })).filter(x => x.by);
        if (!reachable.length) {
          problems.push(
            `${tool}.${param} keys on ${accepted.map(c => `${c.table}.${c.column}`).join(' or ')}, `
            + 'and no tool that can be called with no arguments prints a value from it — nothing hands this id over',
          );
        } else if (VERBOSE) {
          console.log(`        obtainable from ${reachable[0].by}`);
        }
      }
    }

    console.log(
      `[check-reachable] ${examined} required parameter(s) against ${usable.length} identifier column(s): `
      + `${examined - freeText.length - notes.length - coveredElsewhere.length} identifier(s) checked for reachability, `
      + `${freeText.length} too loose to be one, ${coveredElsewhere.length} answered by check-handoffs, `
      + `${notes.length} unclassified; ${problems.length} unreachable`,
    );
    for (const p of problems) console.error(`  UNREACHABLE   ${p}`);
    for (const n of notes) console.error(`  UNCLASSIFIED  ${n}`);
    for (const c of coveredElsewhere) console.log(`  VIA HANDOFFS  ${c}`);
    if (VERBOSE && freeText.length) console.log(`  free text, not asked: ${freeText.join(', ')}`);
  } finally {
    mcp.close();
  }

  logRun('check-reachable', {
    status: problems.length ? 'error' : 'success',
    items: examined,
    error: [...problems, ...notes].join(' ; ').slice(0, 1000) || undefined,
  }, getDb());

  if (problems.length) process.exitCode = 1;
}

main().catch(err => {
  console.error(err);
  logRun('check-reachable', { status: 'error', items: 0, error: String(err).slice(0, 1000) }, getDb());
  process.exitCode = 1;
});
