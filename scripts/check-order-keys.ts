/**
 * A serving ORDER BY must sort on a column that actually varies.
 *
 * THE CLASS. A sort key that holds the same value for every row is not a sort:
 * SQLite returns rows in storage (rowid) order and the "ranking" is arbitrary.
 * When the output also LABELS that order - a "top" list, an "ordered by
 * upvotes" contract - the caller is told a ranking exists where none does.
 *
 * forum_posts.like_count is DEFAULT 0 and Discourse's listing sync never
 * populates it - a single-term `ORDER BY like_count` would return storage
 * order dressed as a ranking. github_discussions.upvotes is currently ordered
 * WITH a tiebreak (`ORDER BY upvotes DESC, created_at DESC`) so it doesn't
 * trip this today, but a future single-term regression on either column is
 * exactly what this check exists to catch (an audit found this exact
 * landmine live in yourpedia's own schema).
 *
 * WHY NOT check-cuts. check-cuts fires on a LIMIT with NO ORDER BY - the rows
 * kept are the lowest rowids. Here an ORDER BY exists, on a constant, so it
 * passed. The two are the same failure (storage order served as if ranked)
 * reached by opposite routes.
 *
 * WHAT THIS WALKS. Every `db.prepare(`…`)` in the MCP serving layer whose SQL
 * has a SINGLE-TERM ORDER BY (no comma tiebreak) on a bare column of the
 * query's FROM table. A single term is the unambiguous case: with a tiebreak
 * the second column still orders the rows, but a lone constant orders
 * nothing. For each, it counts DISTINCT values of that column; one distinct
 * value (or all NULL) over a table with more than one row is a degenerate
 * key. Expressions (rank, COUNT(*), CASE), columns from a joined table it
 * cannot resolve to the FROM table, and multi-term orders are not this and
 * are counted as examined-but-skipped, never silently passed as ok.
 *
 * Negative control: plant `ORDER BY like_count DESC LIMIT 1` on a
 * forum_posts query and this fires; remove it and it is green.
 *
 *   npx tsx scripts/check-order-keys.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { repoPath } from '../lib/repo-root';
import { stripJsComments } from '../lib/strip-comments';

/** Files that build SQL handed to a caller. mcp-server.ts is the tool layer; the
 *  lib/*.ts helpers it calls build the rest. */
function servingFiles(): string[] {
  const files = [repoPath('mcp-server.ts')];
  const libDir = repoPath('lib');
  for (const f of fs.readdirSync(libDir)) {
    if (f.endsWith('.ts') && !f.endsWith('.test.ts')) files.push(path.join(libDir, f));
  }
  return files;
}

async function main(): Promise<void> {
  const db = getDb();
  const problems: string[] = [];
  const seen = new Set<string>();
  let examined = 0;
  let checked = 0;

  const tables = new Set(
    (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map(r => r.name),
  );
  const colsOf = (t: string): Set<string> => {
    try { return new Set((db.prepare(`SELECT name FROM pragma_table_info(?)`).all(t) as { name: string }[]).map(r => r.name)); }
    catch { return new Set(); }
  };

  // Degenerate columns a tool deliberately offers as a sort but GUARDS at
  // runtime, so the interpolated ORDER BY never actually sorts on nothing.
  // Empty today - no yourpedia tool has this shape yet - named with the
  // reason the moment one does, the same way check-counters names
  // upstream-only columns. A future UNGUARDED interpolated degenerate order
  // is not on this list and still fails.
  const GUARDED_DEGENERATE = new Set<string>([]);

  // Check one (table, column) a serving query orders by. Shared by the bare and
  // the interpolated paths so both reach the same distinctness test.
  const checkOrderColumn = (table: string, rawCol: string, note: string): void => {
    const col = rawCol.includes('.') ? rawCol.split('.').pop()! : rawCol;
    const cols = colsOf(table);
    if (!cols.has(col)) return; // rank, an expression, a comparison literal, or a joined column
    const key = `${table}.${col}`;
    if (seen.has(key)) return;
    seen.add(key);
    checked++;
    const stat = db.prepare(`SELECT COUNT(*) n, COUNT(DISTINCT "${col}") d FROM "${table}"`).get() as { n: number; d: number };
    if (stat.n > 1 && stat.d <= 1 && !GUARDED_DEGENERATE.has(key)) {
      problems.push(
        `${key}${note}: ${stat.d} distinct value over ${stat.n} rows - a single-term ORDER BY on it sorts nothing, so the rows come back in storage order. ` +
        `Drop the term, sort on a column that varies, or guard the empty column at runtime.`,
      );
    }
  };

  // `const <var> = cond ? 'colA ASC' : cond ? 'colB DESC' : 'colC'` — the leading
  // identifier of every quoted fragment. Resolves the NEAREST such assignment
  // BEFORE the statement, not the first in the file, since a file can have more
  // than one `const order =` and a global-first match would resolve the wrong
  // handler's candidates. Over-generates (it also catches comparison literals),
  // which is harmless: checkOrderColumn drops any token that is not a column of
  // the table.
  const resolveOrderCandidates = (source: string, varName: string, before: number): string[] => {
    let decl: RegExpMatchArray | null = null;
    for (const d of source.matchAll(new RegExp(`\\b${varName}\\s*=\\s*([^;]*);`, 'g'))) {
      if ((d.index ?? 0) < before) decl = d; else break;
    }
    if (!decl) return [];
    const out: string[] = [];
    for (const lit of decl[1].matchAll(/['"]([^'"]+)['"]/g)) {
      const token = lit[1].trim().split(/\s+/)[0];
      if (/^[A-Za-z_][\w.]*$/.test(token)) out.push(token);
    }
    return out;
  };

  for (const file of servingFiles()) {
    let src: string;
    try { src = stripJsComments(fs.readFileSync(file, 'utf8')); } catch { continue; }
    // Every SQL template literal in the serving code, not only the ones passed
    // to `.prepare(` — a query wrapper (e.g. a `safe(`…`, params)` helper) runs
    // the same SQL and would be invisible to a .prepare-only scan. A SQL
    // literal carries no nested backtick, so a non-backtick run is the whole
    // statement; `${…}` interpolations survive as text for the FROM/ORDER BY
    // anchors.
    for (const m of src.matchAll(/`([^`]*)`/g)) {
      const sql = m[1];
      if (!/\bSELECT\b/i.test(sql) || !/\bFROM\b/i.test(sql)) continue; // not a query literal
      const from = sql.match(/\bFROM\s+([A-Za-z_]\w*)/i);

      // Bare single-term ORDER BY on a column. A comma means a tiebreak orders
      // the rows and this is not the degenerate case.
      const order = sql.match(/ORDER\s+BY\s+([A-Za-z_][\w.]*)\s*(?:ASC|DESC)?\s*(,|LIMIT|\)|;|$)/i);
      if (order) {
        examined++;
        if (order[2] === ',') continue; // multi-term: a later column still orders the rows
        if (!from || !tables.has(from[1])) continue; // subquery/CTE/temp, not a base table
        checkOrderColumn(from[1], order[1], '');
        continue;
      }

      // Interpolated ORDER BY `${var}`, where var is assigned one of several
      // string literals by a ternary — resolve the ternary's candidate
      // columns and check each, so an interpolated order is examined rather
      // than silently skipped.
      const interp = sql.match(/ORDER\s+BY\s+\$\{\s*([A-Za-z_]\w*)\s*\}/);
      if (interp) {
        examined++;
        if (!from || !tables.has(from[1])) continue;
        for (const cand of resolveOrderCandidates(src, interp[1], m.index ?? 0)) {
          checkOrderColumn(from[1], cand, ' (interpolated ORDER BY)');
        }
      }
    }
  }

  // The exemption list is self-policing: an entry that no longer names a
  // degenerate column is a standing licence for the next degenerate order that
  // drifts into it.
  for (const key of GUARDED_DEGENERATE) {
    const [t, c] = key.split('.');
    if (!tables.has(t) || !colsOf(t).has(c)) {
      problems.push(`GUARDED_DEGENERATE names ${key}, which no longer exists — drop the exemption.`);
      continue;
    }
    const st = db.prepare(`SELECT COUNT(*) n, COUNT(DISTINCT "${c}") d FROM "${t}"`).get() as { n: number; d: number };
    if (!(st.n > 1 && st.d <= 1)) {
      problems.push(`GUARDED_DEGENERATE names ${key}, but it now varies (${st.d} distinct over ${st.n} rows) — the column is no longer degenerate, so drop the exemption and let the normal check cover it.`);
    }
  }

  for (const p of problems) console.error(`  [degenerate-order-key] ${p}`);
  console.log(`  ok    order keys   ${checked} distinct serving ORDER BY column(s) checked (of ${examined} single-column orders seen); ${problems.length} degenerate`);

  logRun('order-keys', {
    status: problems.length ? 'error' : 'success',
    items: checked,
    error: problems.length ? `${problems.length} degenerate order key(s): ` + problems.slice(0, 3).map(p => p.slice(0, 90)).join(' | ') : undefined,
  });

  console.log(
    problems.length
      ? `[check-order-keys] ${problems.length} degenerate order key(s) over ${checked} checked`
      : `[check-order-keys] all ${checked} serving ORDER BY column(s) vary`,
  );
  if (problems.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  main().catch(err => {
    console.error('check-order-keys failed:', err);
    logRun('order-keys', { status: 'error', error: String(err).slice(0, 500) });
    process.exit(1);
  });
}
