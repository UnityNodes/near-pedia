/**
 * A `LIMIT n` that does not say which n.
 *
 * WHY THIS EXISTS. `LIMIT n` with no `ORDER BY` is a cut with no criterion.
 * SQLite scans in rowid order, so the n rows kept are the n INSERTED FIRST
 * among the matches, and nothing in the answer says so. This has happened:
 * a learning-path tool returned three of the same four documents for
 * two completely different goals, because insertion order carries no
 * information about either one.
 *
 * WHAT IT ASSERTS, in three gates:
 *
 *   G1 every cut has a criterion. A serving-layer statement ending in LIMIT
 *      must ORDER BY, or hand its rows to rankRows, or be listed below with a
 *      reason. The surface is derived from the tree, not declared, so a new
 *      tool is inside it the moment it is written.
 *
 *   G3 a candidate cap clears the
 *      tables it is used on. rankRows can only order what it was given; a
 *      cap that binds hands it the lowest rowids and the ranking inherits
 *      the bias it exists to remove.
 *
 *   G4 no declared exemption outlives the statement it excuses.
 *
 *   npx tsx scripts/check-cuts.ts
 *   npx tsx scripts/check-cuts.ts --verbose   # also list what was accepted
 */

import fs from 'fs';
import path from 'path';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { stripJsComments } from '../lib/strip-comments';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const VERBOSE = process.argv.includes('--verbose');

/**
 * Cuts that legitimately have no order, each with the reason it is
 * legitimate.
 *
 * Two shapes qualify and no others. An EXISTENCE probe asks whether any row
 * satisfies a predicate, so which row comes back cannot matter: `LIMIT 1`
 * under a COUNT, or a duplicate check that only reads `.length`. A
 * VOCABULARY sample asks what shape the values in a column have, and takes
 * any rows at all.
 *
 * "It only returns a few" is NOT a reason. That is the defect.
 *
 * Empty today: nearpedia's serving layer has no site matching either shape
 * yet, and a real one is added here the moment G1 finds it rather than
 * guessed at in advance.
 */
const ALLOWED: { file: string; match: string; why: string }[] = [];

/**
 * Does an interpolated fragment carry the ORDER BY?
 *
 * `... ${where} ${order} LIMIT ?` really does order, and no reading of the
 * literal can see it. Resolve the variable instead of guessing from its
 * position: find its assignment in the same file and require an actual
 * ORDER BY in the value - a hole sitting anywhere before LIMIT is not
 * evidence on its own, since a hole in the LIMIT itself (e.g. a candidate
 * cap) would otherwise be waved through by the gate written to catch it.
 */
function orderArrivesInAHole(sql: string, src: string): boolean {
  for (const m of sql.matchAll(/\$\{\s*(\w+)(?:\.\w+)?\s*\}/g)) {
    const name = m[1];
    const decl = new RegExp(`\\b(?:const|let|var)\\s+${name}\\b[^\\n;]*`, 'g');
    for (const d of src.matchAll(decl)) if (/order\s+by/i.test(d[0])) return true;
    // Assigned across several lines, e.g. `let order = '...'` then reassigned.
    const asg = new RegExp(`\\b${name}\\s*=[^\\n;]*`, 'g');
    for (const a of src.matchAll(asg)) if (/order\s+by/i.test(a[0])) return true;
  }
  return false;
}

interface Cut { file: string; line: number; sql: string; ranked: boolean; orderedByHole: boolean }

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.next') || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/**
 * The serving layer: what an agent or a visitor can reach. scripts/ is
 * excluded deliberately - a sync or a check taking an arbitrary sample is
 * not answering anybody.
 */
function servingFiles(): string[] {
  return [
    path.join(ROOT, 'mcp-server.ts'),
    ...walk(path.join(ROOT, 'lib')),
    ...walk(path.join(ROOT, 'app')),
  ].filter(f => fs.existsSync(f));
}

/**
 * Is this statement's result handed to rankRows, by NAME rather than by
 * position?
 *
 * nearpedia's own tools don't wrap the query inside the rankRows(...) call
 * the way an inline pattern would - they assign the candidate rows to a
 * variable (`const wpCandidates = db.prepare(...).all(...)`) and rank it a
 * few lines later, often after an early-return or another query sits
 * between the two. A same-line-or-one-before check misses every one of
 * these and reports 7 genuinely-ranked candidate fetches as unordered cuts.
 *
 * Two-sided by construction: capture the variable this statement assigns
 * to, then look for `rankRows(..., thatVariable, ...)` forward from here,
 * bounded to before the next `server.tool(` registration so a common name
 * like `candidates` reused in a sibling tool can't cross-match.
 */
function isRankedViaVariable(src: string, lineStart: number, stmtEnd: number): boolean {
  const head = src.slice(lineStart, stmtEnd);
  // `const x = db.prepare(` (declared and assigned together) or a plain
  // `x = db.prepare(` reassignment - `let candidates: any[];` declared once
  // above an if/else, then assigned per-branch with no `let` on the
  // assignment line, is a real shape here (find_collaboration_opportunities).
  const varM = /\b(?:(?:const|let)\s+)?(\w+)\s*=\s*db\.prepare\s*\(/.exec(head);
  if (!varM) return false;
  const varName = varM[1];
  const rest = src.slice(stmtEnd, stmtEnd + 4000);
  const nextTool = rest.search(/\bserver\.tool\(/);
  const window = nextTool === -1 ? rest : rest.slice(0, nextTool);
  return new RegExp(`\\brankRows\\s*\\([^;]*\\b${varName}\\b`).test(window);
}

function extractCuts(file: string): Cut[] {
  const src = stripJsComments(fs.readFileSync(file, 'utf8'));
  const rel = path.relative(ROOT, file);
  const out: Cut[] = [];
  for (const m of [
    ...src.matchAll(/`([^`\\]*(?:\\.[^`\\]*)*)`/g),
    ...src.matchAll(/'([^'\\\n]*(?:\\.[^'\\\n]*)*)'/g),
  ]) {
    const sql = m[1];
    if (!/^\s*(SELECT|WITH)\b/i.test(sql.trim())) continue;
    if (!/\blimit\s+(\d+|\?|@\w+|:\w+|\$\{[^}]*\})/i.test(sql)) continue;
    const litStart = m.index ?? 0;
    const before = src.slice(0, litStart);
    const line = before.split('\n').length;
    const lineStart = before.lastIndexOf('\n') + 1;
    // rankRows takes the rows this statement returns and orders them in
    // code, so the SQL is a CANDIDATE fetch and has no business ordering.
    // Two independent ways a statement reaches rankRows: wrapped directly
    // (opener check, the line this literal opens on plus the one above),
    // or assigned to a variable ranked a few lines later (name-tracked,
    // see isRankedViaVariable). A character-window proximity guess is
    // neither: it would let an unordered cut inherit an unrelated
    // neighbour's rankRows.
    const lines = before.split('\n');
    const opener = lines.slice(-2).join('\n');
    // litEnd: end of the closing quote/backtick, where `.all(...)` follows.
    const litEnd = litStart + m[0].length;
    const stmtEndM = /\)\s*(?:as\s+[^;]+)?;/.exec(src.slice(litEnd, litEnd + 400));
    const stmtEnd = stmtEndM ? litEnd + stmtEndM.index + stmtEndM[0].length : litEnd;
    out.push({
      file: rel, line, sql: sql.replace(/\s+/g, ' ').trim(),
      ranked: /rankRows\s*\(/.test(opener) || isRankedViaVariable(src, lineStart, stmtEnd),
      orderedByHole: orderArrivesInAHole(sql, src),
    });
  }
  return out;
}

function main() {
  const db = getDb();
  const problems: string[] = [];
  const accepted: string[] = [];
  const usedAllowed = new Set<string>();

  // ---- G1: every cut names a criterion -----------------------------------
  let cuts = 0;
  for (const f of servingFiles()) {
    for (const c of extractCuts(f)) {
      cuts++;
      if (/\border\s+by\b/i.test(c.sql)) { accepted.push(`${c.file}:${c.line} orders`); continue; }
      if (c.orderedByHole) { accepted.push(`${c.file}:${c.line} orders via an interpolated fragment`); continue; }
      if (c.ranked) { accepted.push(`${c.file}:${c.line} ranked in code`); continue; }
      const ok = ALLOWED.find(a => a.file === c.file && c.sql.includes(a.match));
      if (ok) { usedAllowed.add(`${ok.file}|${ok.match}`); accepted.push(`${c.file}:${c.line} allowed: ${ok.why}`); continue; }
      problems.push(
        `BROKEN ${c.file}:${c.line} cuts with LIMIT and names no order.\n`
        + `         ${c.sql.slice(0, 150)}\n`
        + `         Give it an ORDER BY, hand the rows to rankRows, or add it to ALLOWED with the reason it cannot matter.`,
      );
    }
  }

  // ---- G4: no exemption outlives the statement it excuses -----------------
  // An ALLOWED entry that matches nothing is a licence sitting in the file
  // waiting for a future statement to drift into its shape.
  for (const a of ALLOWED) {
    if (!usedAllowed.has(`${a.file}|${a.match}`)) {
      problems.push(
        `BROKEN scripts/check-cuts.ts ALLOWED exempts "${a.match}" in ${a.file}, and no cut there matches it any more.\n`
        + `         Delete the entry. Left in place it silently excuses the next statement that happens to contain that text.`,
      );
    }
  }

  // ---- G3: the candidate cap clears every table it ranks ------------------
  const src = stripJsComments(fs.readFileSync(path.join(ROOT, 'mcp-server.ts'), 'utf8'));
  const capM = /const RANK_CAND_CAP\s*=\s*(\d+)/.exec(src);
  if (!capM) {
    problems.push('BROKEN mcp-server.ts no longer defines RANK_CAND_CAP, so G3 cannot check the candidate ceiling. Re-point this gate, do not delete it.');
  } else {
    const cap = Number(capM[1]);
    // Every table fetched under the cap, taken from the statements
    // themselves. nearpedia's own shape: `FROM table WHERE (...) LIMIT ?`
    // as a template literal, immediately followed by `.all(...args,
    // RANK_CAND_CAP)` - one consistent shape at every call site.
    const tables = new Set<string>();
    for (const m of src.matchAll(/FROM\s+([a-z_]\w*)((?:(?!\bFROM\b)[\s\S]){0,400}?)LIMIT\s+\?`\)\.all\([^)]*RANK_CAND_CAP/gi)) {
      tables.add(m[1]);
    }
    if (tables.size === 0) {
      problems.push('BROKEN RANK_CAND_CAP is defined but this gate matched no statement using it, so it is checking nothing. Fix the scan, do not drop the gate.');
    }
    for (const t of tables) {
      let held = -1;
      try { held = (db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get() as { c: number }).c; } catch { continue; }
      if (held > cap) {
        problems.push(
          `BROKEN RANK_CAND_CAP ${cap} BINDS on ${t}: the table holds ${held}.\n`
          + `         rankRows would be handed the ${cap} lowest rowids and would rank a sample chosen by insertion order, which is the defect it exists to remove.`,
        );
      } else {
        accepted.push(`RANK_CAND_CAP clears ${t}: ${held} of ${cap}`);
      }
    }
  }

  if (VERBOSE) for (const a of accepted) console.log(`  ok   ${a}`);
  for (const p of problems) console.log(p);

  const msg = problems.length
    ? `[check-cuts] ${problems.length} problem(s) over ${cuts} cut(s)`
    : `[check-cuts] ${cuts} cuts, every one names its order; ${ALLOWED.length} exemptions all still used; the candidate cap clears every table it ranks`;
  console.log(msg);
  // items = cuts examined, which is the surface this walked.
  logRun('cuts', {
    status: problems.length ? 'partial' : 'success',
    items: cuts,
    error: problems.length ? problems.join(' ; ').slice(0, 1000) : undefined,
  }, db);
  if (problems.length) process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error('check-cuts failed:', err);
  logRun('cuts', { status: 'error', error: String(err).slice(0, 500) });
  process.exit(1);
}
