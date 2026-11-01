/**
 * Does the corpus still agree with what we said we do not hold?
 *
 * THE CLASS. A refusal enforced at the door is a statement about the next
 * write. It says nothing about the rows already in the table, and nothing
 * about the other doors into it. Every standing check we had reads the
 * corpus against upstream, or against itself; none asks whether the corpus
 * contradicts our own stated policy.
 *
 * THE SURFACE, and how it is counted. lib/refusals.ts holds the rules; this
 * walks REFUSALS and asks the table each one is about. It also walks the
 * ingest sources for rulebooks that never made it into that file, so the
 * registry cannot quietly go stale as new rules are written. Both numbers
 * are printed on every run rather than being retyped into a comment here.
 *
 * TWO SIDES, TWO SOURCES. The predicate comes from lib/refusals.ts, the
 * rows come from SQLite. Nothing here re-implements a rule in order to
 * check it: a check whose two halves are the same rule twice can only pass.
 *
 * WHAT IT CANNOT SEE. A refusal that cannot be re-decided from a stored row
 * (upstream state, a length test on text we never stored, a time window) is
 * not registerable, and NOT_ROW_DECIDABLE in lib/refusals.ts names those
 * with the reason instead of leaving them silently uncovered.
 *
 *   npx tsx scripts/check-refusals.ts
 *   npx tsx scripts/check-refusals.ts --verbose   # every offending row
 *   DB_PATH=/path/copy.db npx tsx scripts/check-refusals.ts      # scratch copy
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { REFUSALS, NOT_ROW_DECIDABLE, type HeldRow } from '../lib/refusals';

const VERBOSE = process.argv.includes('--verbose');
const SAMPLE = 5;

/**
 * Ingest files whose rulebooks this check expects to find in lib/refusals.ts.
 *
 * Anything else declared at module scope in one of them and consulted by a
 * drop decision is either a refusal nobody registered, or something that is
 * not a refusal at all and belongs in NOT_A_REFUSAL below with the reason.
 */
const INGEST_DIR = 'scripts';
const INGEST_FILE_RE = /^(sync-.*|refresh-radar|refresh-trending|import-pdf-local)\.ts$/;

/**
 * Module-scope names in ingest files that a drop decision consults and that
 * are NOT refusals we can hold the table to. Exact, not a blanket pardon: a
 * name is excused here for a stated reason, so that a new blocklist
 * appearing under a name nobody has classified is loud.
 */
const NOT_A_REFUSAL: Record<string, string> = {
  'sync-papers.ts:RELEVANT':
    "the arXiv topic filter. It IS a refusal - registered below as 'whitepaper-arxiv-relevance', restated rather than imported per this file's header (importing would make the ingest side and the check side one source)",
  'sync-cips.ts:CIP_FILE_RE':
    'the shape a repo tree path must match to be considered a CIP file at all (requires digits between cip- and .md). Upstream-path state, never stored - cips.id holds only the derived number, not the path it came from',
  'sync-cips.ts:CIP_TEMPLATE_RE':
    'meant to exclude cip-template.md, but CIP_FILE_RE already requires digits in the filename and "template" has none, so this is unreachable dead code, not an active drop decision',
};

interface Violation { rule: string; what: string; table: string; rows: string[] }

/** Names a drop decision consults, per ingest file. Approximate on purpose. */
function declaredRulebooks(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const dir = path.join(process.cwd(), INGEST_DIR);
  for (const file of fs.readdirSync(dir).filter(f => INGEST_FILE_RE.test(f)).sort()) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    const lines = src.split('\n');

    const declared: string[] = [];
    for (const line of lines) {
      const c = line.match(/^(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*(new Set\b|\/|\[)/);
      if (c) declared.push(c[1]);
      const f = line.match(/^(?:export\s+)?function\s+((?:is|looks|should)[A-Za-z0-9_]*)\s*\(/);
      if (f) declared.push(f[1]);
    }

    const consulted = [...new Set(declared)].filter(name => {
      const re = new RegExp(`\\b${name}\\b`);
      return lines.some((l, i) => {
        if (!re.test(l)) return false;
        const window = lines.slice(i, i + 3).join(' ');
        return /\.filter\(/.test(l) || /(continue\s*;|return false|return null|return\s*;)/.test(window);
      });
    });
    if (consulted.length) out.set(file, consulted);
  }
  return out;
}

function main(): void {
  const db = getDb();
  const violations: Violation[] = [];
  let rowsWalked = 0;

  for (const rule of REFUSALS) {
    const rows = db.prepare(rule.sql).all() as HeldRow[];
    rowsWalked += rows.length;
    const bad = rows.filter(r => rule.refuses(r));
    if (bad.length) {
      violations.push({
        rule: rule.id,
        what: rule.what,
        table: rule.table,
        rows: (VERBOSE ? bad : bad.slice(0, SAMPLE)).map(r => rule.label(r)),
      });
    }
    const mark = bad.length ? `HELD ${bad.length}` : 'clean';
    console.log(`  ${bad.length ? 'FAIL' : ' ok '}  ${rule.id.padEnd(28)} ${String(rows.length).padStart(6)} row(s) governed, ${mark}`);
  }

  const books = declaredRulebooks();
  const unclassified: string[] = [];
  let seen = 0;
  for (const [file, names] of books) {
    for (const name of names) {
      seen++;
      if (NOT_A_REFUSAL[`${file}:${name}`]) continue;
      unclassified.push(`${file}:${name}`);
    }
  }
  const stale = Object.keys(NOT_A_REFUSAL).filter(key => {
    const [file, name] = key.split(':');
    return !(books.get(file) ?? []).includes(name);
  });

  console.log('');
  console.log(`registered refusals:      ${REFUSALS.length} over ${new Set(REFUSALS.map(r => r.table)).size} table(s), ${rowsWalked} row(s) walked`);
  console.log(`not row-decidable:        ${Object.keys(NOT_ROW_DECIDABLE).length} named with a reason`);
  console.log(`ingest rulebooks seen:    ${seen} across ${books.size} file(s)`);
  console.log(`  classified not-refusal: ${Object.keys(NOT_A_REFUSAL).length}`);
  console.log(`  unclassified:           ${unclassified.length}`);

  const problems: string[] = [];

  for (const v of violations) {
    console.error(`\nHELD BUT REFUSED  ${v.rule} (${v.table}): ${v.what}`);
    for (const r of v.rows) console.error(`    ${r}`);
    if (!VERBOSE && v.rows.length === SAMPLE) console.error('    ... (--verbose for all)');
    problems.push(`${v.rule}: ${v.rows.length}${VERBOSE ? '' : '+'} row(s) held that ${v.what}`);
  }

  if (unclassified.length) {
    console.error(`\nUNCLASSIFIED RULEBOOK  ${unclassified.join(', ')}`);
    console.error('    Register it in lib/refusals.ts REFUSALS, or say why it is not a refusal');
    console.error('    in NOT_A_REFUSAL here. A rule no check knows about is the whole problem.');
    problems.push(`${unclassified.length} ingest rulebook(s) neither registered nor classified: ${unclassified.join(', ')}`);
  }

  if (stale.length) {
    console.error(`\nSTALE CLASSIFICATION  ${stale.join(', ')}`);
    console.error('    Named in NOT_A_REFUSAL but no longer declared in that file.');
    problems.push(`${stale.length} stale NOT_A_REFUSAL entr(ies): ${stale.join(', ')}`);
  }

  logRun('check-refusals', {
    status: problems.length ? 'partial' : 'success',
    items: REFUSALS.length,
    error: problems.length ? problems.join(' ; ').slice(0, 1000) : undefined,
  }, db);

  if (problems.length) {
    console.error(`\ncheck-refusals: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log('\ncheck-refusals: the corpus agrees with every rule we can ask it about');
}

try {
  main();
} catch (err) {
  console.error('check-refusals failed:', err);
  logRun('check-refusals', { status: 'error', error: String(err).slice(0, 500) });
  process.exit(1);
}
