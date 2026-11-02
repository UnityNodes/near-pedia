/**
 * Compile every SQL statement in the serving layer against the real schema.
 *
 * WHY THIS EXISTS. A serving-layer audit on 2026-08-01 found eight queries that
 * had never been able to run, each one named a column that does not exist, and
 * each one wrapped in a catch that answered with `0`, `[]` or `null`:
 *
 *   doc_pages.content       -> four MCP tools. outdated_guidance_detector, whose
 *                              entire job is to warn, answered "nothing
 *                              outdated" to every question ever asked of it, and
 *                              2006 documentation pages were invisible to
 *                              detect_drift, learning_path and full_context.
 *   github_items.closed_at  -> compare_governance_outcomes printed a bold
 *                              "PRs closed/merged: 0" beside a working
 *                              "opened: 23". The table holds 2987 closed items.
 *   github_items.updated_at -> /api/v1/sources published newest_item: null
 *   sdk_versions.published_at  for three of its sixteen sources.
 *   forum_posts.created_at_ms -> the homepage printed "Forum today 0 new posts"
 *                              on every one of the last 30 days.
 *
 * NOTHING CATCHES THIS TODAY, which is the point of the file:
 *
 *   - `tsc` type-checks the string, not the schema. All eight passed.
 *   - the `sqlite3` CLI is worse than useless here. It is built with the
 *     double-quoted-string misfeature ENABLED, so `WHERE tldr <> ""` returns a
 *     confident 125 there and throws `no such column: ""` inside the app.
 *     Verifying a query with the CLI can actively mislead you.
 *   - the tests do not touch these paths, and a catch means an error never
 *     reaches a log.
 *
 * better-sqlite3 is the only oracle that matches production, because it IS
 * production. `prepare()` resolves every table and column without executing
 * anything, so this is a read-only compile of the whole surface in a second.
 *
 * IT ALSO OWNS THE CLOCK QUESTION, because it is the only place that can answer
 * it. A tool that sorts by OUR fetch clock and calls the result "most recent"
 * states a fact about its own crawl in the grammar of a fact about the world:
 * detect_drift ordered doc_pages by synced_at, printed the fetch date as the
 * document's, and fired on 0 of 20 topics because docs are re-synced daily and
 * nothing could ever be newer.
 *
 * A grep cannot ask this. `lib/governance.ts` sorts by `first_seen`, which reads
 * exactly like our clock and is an ALIAS for `MIN(changed_at)`, an upstream
 * date. A regex reports it and is wrong. `prepare()` already resolved that here,
 * and `stmt.columns()` says whether a name is a real column or an expression, so
 * the answer is free at this point and honest.
 *
 *   npx tsx scripts/check-sql.ts            # report, exit 1 on a real failure
 *   npx tsx scripts/check-sql.ts --verbose  # also list what was skipped
 */

import fs from 'fs';
import path from 'path';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { stripJsComments } from '../lib/strip-comments';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const VERBOSE = process.argv.includes('--verbose');

/**
 * A string that was meant to be a whole statement.
 *
 * Both halves are needed. The head alone matched `Delete chat` (a button label),
 * `Update SV reward weight` (a governance action name) and eight bare `delete`s,
 * because the extractor pulls any string and English starts with those words
 * too. The landmark is what separates a sentence from a statement: real SQL
 * names where the rows come from or go to.
 */
const STATEMENT_HEAD = /^\s*(?:WITH|SELECT|INSERT|REPLACE|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA|VACUUM|ANALYZE)\b/i;
const STATEMENT_LANDMARK = /\b(?:FROM|INTO|SET|TABLE|INDEX|VALUES|PRAGMA)\b/i;

/** Files whose SQL is served to somebody. Sync scripts are a separate concern. */
const TARGETS = ['mcp-server.ts', 'middleware.ts'];
// components/ is here because leaving it out is how this check missed a live
// bug on its first run. A dashboard component queried
// forum_posts.created_at_ms, a column that has never existed, and the homepage
// printed "Forum today 0 new posts" every day as a result. The check reported
// clean, and so did I, because I had grepped app/ and lib/ and concluded the
// column appeared nowhere. A checker is only as wide as its search path.
const TARGET_DIRS = ['app', 'lib', 'components'];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Pull out anything that looks like a statement.
 *
 * Backtick, single- and double-quoted strings all count: the bug that started
 * this was inside a single-quoted string, and mcp-server.ts uses all three.
 */
/**
 * Columns stamped by US when a row is fetched or written, not by upstream.
 *
 * Sorting by one of these is not wrong in itself. It is wrong when the answer is
 * then presented as recency in the world: `captured_at` IS the axis of a
 * snapshot series and those tools say "Captured:" on the line above the number.
 * So each use is declared with which of the two it is, rather than banned.
 */
const OUR_CLOCKS = new Set([
  'synced_at', 'first_seen', 'last_seen', 'captured_at',
  'transcript_synced_at', 'tldr_generated_at', 'ran_at', 'updated_at',
]);

/**
 * Sorting by our own clock, declared per file and column, with why it is honest.
 *
 * An undeclared one fails. The alternative was a rule that no query may sort by
 * these, which would be false: a snapshot series has no other axis.
 */
const CLOCK_SORTS: Record<string, string> = {
  'lib/sync-log.ts::ran_at': 'log retention, keeping the newest N rows per source. ran_at is when WE ran, which is exactly the subject, and nothing is served from this statement',
};

/** The first sort key of a statement, or null when it does not order. */
function firstOrderKey(sql: string): string | null {
  const m = /\border\s+by\s+([a-z_][\w.]*)/i.exec(sql);
  if (!m) return null;
  return m[1].includes('.') ? m[1].split('.').pop()! : m[1];
}

function extractSql(src: string): string[] {
  const found: string[] = [];
  const literals = [
    ...src.matchAll(/`([^`\\]*(?:\\.[^`\\]*)*)`/g),
    ...src.matchAll(/'([^'\\\n]*(?:\\.[^'\\\n]*)*)'/g),
    ...src.matchAll(/"([^"\\\n]*(?:\\.[^"\\\n]*)*)"/g),
  ];
  for (const m of literals) {
    const raw = m[1];
    if (!/^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(raw)) continue;
    found.push(raw);
  }
  return found;
}

/**
 * Make an interpolated statement compilable without changing which tables and
 * columns it names.
 *
 * `${...}` holes are usually a WHERE fragment, an ORDER BY direction or a table
 * alias. Replacing them with `1=1` keeps the statement valid in the common case;
 * where it does not, the result is a SYNTAX error, which is filtered out below.
 * Only "no such column" and "no such table" are reported, and neither can be
 * produced by this substitution.
 */
function neutralise(sql: string): { sql: string; substituted: number } {
  let substituted = 0;
  const out = sql.replace(/\$\{[^}]*\}/g, () => { substituted++; return ' 1=1 '; });
  // A hole containing a brace of its own — `${xs.map(s => `${s}`)}` — is wider
  // than `[^}]*` can span, so it survives the replace. Counting it here keeps a
  // half-substituted string out of the findings, where it would be reported as a
  // syntax error the source does not have.
  return { sql: out, substituted: substituted + (out.includes('${') ? 1 : 0) };
}

/**
 * Column names that never appear inside a SQL string.
 *
 * `anyTokenLike(['title', 'content'], tokens)` builds its WHERE clause at
 * runtime, so no static reading of the statement can see `content`. That is
 * precisely how the doc_pages bug hid from every tool above: three of the four
 * broken queries WERE caught by compiling the statement, and the fourth was
 * invisible because the column name lived in a JavaScript array.
 *
 * The test is deliberately weak: does this name exist as a column on ANY table?
 * Associating a helper call with the table its statement targets is not
 * something a text scan can do honestly. A name that exists nowhere is
 * unambiguous, and `content` was exactly that.
 */
function checkHelperColumns(db: ReturnType<typeof getDb>, files: string[]): { file: string; msg: string; sql: string }[] {
  // Columns per table, so the check can be about the RIGHT table.
  //
  // The first version of this asked "does this name exist on any table at all",
  // which sounds close enough and is worthless here: `content` is a real column
  // on another table, so the doc_pages bug would have passed. A negative control
  // caught that — the check reported clean on a deliberately reintroduced bug.
  // Verify a checker against the failure it was written for, or it only produces
  // confidence.
  const byTable = new Map<string, Set<string>>();
  for (const t of db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]) {
    byTable.set(t.name, new Set((db.pragma(`table_info("${t.name}")`) as { name: string }[]).map(c => c.name)));
  }

  const out: { file: string; msg: string; sql: string }[] = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    // `const docsM = anyTokenLike([...], tokens)` followed, within a few lines,
    // by a statement that interpolates `${docsM.sql}` and names its table. That
    // is the shape every call site in this repo uses.
    for (const m of src.matchAll(/const\s+(\w+)\s*=\s*anyTokenLike\(\s*\[([^\]]*)\]/g)) {
      const [, varName, colList] = m;
      const after = src.slice(m.index ?? 0, (m.index ?? 0) + 1200);
      // Tie the matcher to the FROM of ITS OWN statement, not the nearest FROM
      // in the window. A handler with two matchers over two tables -
      // find_known_issues has `forumM -> forum_topics` and `issuesM ->
      // github_items` a few lines apart - put the forum_topics FROM within 400
      // chars before `${issuesM.sql}`, so the old regex read issuesM's `body`
      // (a real github_items column) as a missing forum_topics column and
      // reported a bug that does not exist. The `(?!FROM)` guard forbids an
      // intervening FROM, so the captured table is the one the interpolation's
      // own statement names.
      const use = after.match(new RegExp(`FROM\\s+["'\`]?(\\w+)(?:(?!\\bFROM\\b)[\\s\\S]){0,400}?\\$\\{${varName}\\.sql\\}|\\$\\{${varName}\\.sql\\}(?:(?!\\bFROM\\b)[\\s\\S]){0,400}?FROM\\s+["'\`]?(\\w+)`));
      const table = use?.[1] ?? use?.[2];
      if (!table) continue;                       // could not tie it to a table
      const cols = byTable.get(table);
      if (!cols) continue;                        // alias or CTE, not a base table
      for (const rawCol of colList.split(',')) {
        const col = rawCol.trim().replace(/^['"`]|['"`]$/g, '');
        if (!col || col.includes('.') || col.includes('$')) continue;
        if (!cols.has(col)) {
          out.push({
            file: path.relative(ROOT, file),
            msg: `no such column: ${col} on ${table} (passed to anyTokenLike, so it never appears in the statement)`,
            sql: `const ${varName} = anyTokenLike([... '${col}' ...]) -> FROM ${table}`,
          });
        }
      }
    }
  }
  return out;
}

/**
 * Every LIKE built from caller text must escape it.
 *
 * `_` is a single-character wildcard and `%` is any run of them, so a caller
 * term carrying either silently widens its own search. This is a technical
 * corpus, where the terms people paste are error codes and identifiers:
 *
 *   NOT_FOUND   matched 153 forum posts; the literal code is in 35. The rest
 *               are English - "not found it", "not an admin", "not call fun".
 *   TOPOLOGY_   matched 178; the literal prefix is in 5.
 *   party_id    matched 276 doc_pages; 104 contain the term.
 *
 * get_recurring_issue_fingerprint, whose whole job is counting which errors keep
 * coming back, reported NOT_FOUND across 7 months and 10 posts. Escaped, it is
 * 3 and 3.
 *
 * lib/search.ts has escaped its needles since likeClause was written, and
 * lib/rank.ts has exported escLike for as long. Nothing carried the rule to the
 * other 36 sites, and mcp-server.ts's shared anyTokenLike - which feeds 35 tool
 * queries - was one of them.
 *
 * TWO HALVES, because either alone is worse than neither: an escaped needle
 * against a LIKE with no ESCAPE searches for a literal backslash and matches
 * nothing, and an ESCAPE with an unescaped needle changes nothing.
 */
/**
 * Sites where a `%` in the bound value is the POINT.
 *
 * Declared, with the reason, because escaping them would break the thing they
 * do. Anything not here has to escape: a caller's wildcard is a caller's typo.
 */
const LIKE_EXCEPTIONS: { at: string; why: string }[] = [];

function likeEscaping(files: string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    if (LIKE_EXCEPTIONS.some((e) => e.at === rel)) continue;
    const src = fs.readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      // a needle built from a variable, not run through escLike
      for (const m of line.matchAll(/`%\$\{([^}]+)\}%`/g)) {
        if (!/escLike\s*\(/.test(m[1])) {
          out.push(`${rel}:${i + 1} — \`%\${${m[1]}}%\` is a LIKE needle built from a value that is not escaped. Wrap it in escLike() and give the clause ESCAPE '\\'.`);
        }
      }
      // a LIKE ? with no ESCAPE anywhere on the line
      if (/\bLIKE\s+\?/.test(line) && !/ESCAPE/.test(line) && !/LIKE \? \|\|/.test(line)) {
        out.push(`${rel}:${i + 1} — a LIKE ? with no ESCAPE clause; a caller's _ or % is a wildcard here.`);
      }
    });
  }
  return [...new Set(out)];
}

function main(): void {
  const db = getDb();
  const files = [
    ...TARGETS.map(f => path.join(ROOT, f)),
    ...TARGET_DIRS.flatMap(d => walk(path.join(ROOT, d))),
  ].filter(f => fs.existsSync(f));

  let compiled = 0;

  let clockSorts = 0;

  const clockProblems: string[] = [];

  const seenDecls = new Set<string>();
  let skipped = 0;
  const failures: { file: string; msg: string; sql: string }[] = [];

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    // Comments are stripped first. A comment that NAMES a statement is not a
    // statement: lib/log-retention.ts documents itself with `INSERT INTO
    // sync_log` in prose, and that fragment was reported as a whole statement
    // that would not parse.
    for (const raw of extractSql(stripJsComments(fs.readFileSync(file, 'utf8')))) {
      const { sql, substituted } = neutralise(raw);
      try {
        const stmt = db.prepare(sql);
        compiled++;
        // The clock gate. prepare() has already resolved every name, so ask it
        // rather than the text: a sort key that appears in the result columns
        // with no source column behind it is an expression alias
        // (MIN(changed_at) AS first_seen), not our clock, and reporting it is
        // how a grep-based version of this became a false-positive machine.
        const key = firstOrderKey(sql);
        if (key && OUR_CLOCKS.has(key)) {
          let isAlias = false;
          try {
            isAlias = stmt.columns().some(c => c.name === key && c.column === null);
          } catch { /* not a statement with result columns */ }
          if (!isAlias) {
            clockSorts++;
            const decl = `${rel}::${key}`;
            seenDecls.add(decl);
            if (!CLOCK_SORTS[decl]) {
              clockProblems.push(
                `${rel}: sorts by ${key}, which is OUR clock, and nothing says the answer is not being presented as recency in the world`
                + ` | ${sql.replace(/\s+/g, ' ').slice(0, 80)}`,
              );
            }
          }
        }
      } catch (err) {
        const msg = (err as Error).message;
        // A missing table or column is unambiguous — unless the missing NAME is
        // the placeholder itself. `SELECT "${c.column}" FROM "${c.table}"` in
        // lib/formats.ts becomes `SELECT " 1=1 " FROM " 1=1 "`, and this branch
        // reported `no such table: 1=1` every day for two weeks. The comment
        // here used to say a substitution could never produce this; it can, when
        // the hole WAS the identifier.
        if (/no such (column|table):\s*"?\s*1=1\s*"?/i.test(msg)) {
          skipped++;
          if (VERBOSE) console.log(`  skip ${rel}: identifier was a template hole | ${sql.replace(/\s+/g, ' ').slice(0, 70)}`);
          continue;
        }
        if (/no such (column|table)/i.test(msg)) {
          failures.push({ file: rel, msg, sql: sql.replace(/\s+/g, ' ').slice(0, 150) });
          continue;
        }
        // Everything else used to go into one bucket called "not whole
        // statements" — 130 of 888, printed as a number and gated by nothing.
        // A bucket that size is a place for a real syntax error to live
        // undisturbed, because a fragment like `WHERE id = ?` and a whole SELECT
        // with a typo in it fail with the same "near" message.
        //
        // The rule that splits them is whether anything was SUBSTITUTED. A
        // template hole becomes ` 1=1 `, so `FROM docs ${where}` compiles to
        // `FROM docs 1=1` and fails for a reason the source does not have: with
        // a substitution in it, a parse error is unattributable. With none, the
        // string is exactly what reaches SQLite at runtime, and a whole
        // statement that will not parse is a defect.
        //
        // (Splitting on "does it begin with a statement keyword" was tried first
        // and called all 130 defects, because the artifact sits INSIDE the
        // statement, not at its head.)
        if (substituted === 0 && STATEMENT_HEAD.test(sql.trim()) && STATEMENT_LANDMARK.test(sql)) {
          failures.push({
            file: rel,
            msg: `whole statement that does not parse: ${msg}`,
            sql: sql.replace(/\s+/g, ' ').slice(0, 150),
          });
          continue;
        }
        skipped++;
        if (VERBOSE) console.log(`  skip ${rel}: ${msg.slice(0, 60)} | ${sql.replace(/\s+/g, ' ').slice(0, 70)}`);
      }
    }
  }

  failures.push(...checkHelperColumns(db, files));

  for (const decl of Object.keys(CLOCK_SORTS)) {
    if (!seenDecls.has(decl)) clockProblems.push(`${decl} is declared as an honest clock sort but no statement sorts that way; re-point it rather than leaving false coverage`);
  }
  for (const c of clockProblems) console.error(`  [clock] ${c}`);
  const likeProblems = likeEscaping(files);
  for (const l of likeProblems) console.error(`  [like] ${l}`);
  console.log(`[check-sql] ${compiled} statements compiled, ${skipped} not whole statements, ${failures.length} referencing something that does not exist, ${clockSorts} sorting by our own clock (${clockProblems.length} undeclared), ${likeProblems.length} LIKE(s) that do not escape a caller's wildcards`);
  for (const f of failures) {
    console.error(`\n  ${f.file}\n    ${f.msg}\n    ${f.sql}`);
  }

  logRun('check-sql', {
    status: failures.length ? 'partial' : 'success',
    items: compiled,
    error: failures.length
      ? failures.map(f => `${f.file}: ${f.msg}`).join(' ; ').slice(0, 1000)
      : undefined,
  }, db);

  if (failures.length || clockProblems.length || likeProblems.length) process.exitCode = 1;
}

main();
