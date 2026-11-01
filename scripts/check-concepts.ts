/**
 * Do this repo's several implementations of one idea still agree?
 *
 * THE CLASS. One concept, more than one implementation, and nothing compares
 * them. Duplication alone is harmless; it bites when the output is an identity
 * or a decision, because then two copies drifting apart means two answers to a
 * question that has one. This has happened: a version comparator answered
 * that 2.0.0 is newer than 2.0.1-rc1 while two siblings answered correctly,
 * found by comparing the three implementations rather than by reading data.
 *
 * WHAT IT READS. The actual bytes of each implementation, extracted from its
 * file by name and evaluated. Not a copy of the logic living here - a check
 * whose two sides are the same code twice can only pass. Editing either
 * implementation changes what this runs.
 *
 * THE SURFACE, and why it is small on purpose. Two names cleared the bar of
 * "an identity or a decision written to a column two different implementations
 * both feed": parsePublishDate (youtube_videos.published_at, written by both
 * sync-youtube and backfill-video-dates) and escLike (the LIKE-escaping
 * contract, applied by both lib/rank.ts and lib/search.ts before every LIKE
 * clause built from user input). Everything else that shares a name here -
 * slugify, buildUrl, fetchJson, sleep, git - never sees the same input or
 * writes the same column, so lib/concepts.ts records it in NOT_SHARED with the
 * reason rather than asserting a contract nobody signed.
 *
 * TWO SIDES, TWO SOURCES: implementation A's real source against implementation
 * B's real source, over inputs from the database. Nothing here knows the right
 * answer, only whether the answers differ - which is the defect itself.
 *
 * WHAT IT CANNOT SEE:
 *   - An implementation that closes over an import, a DOM node or a database
 *     handle cannot be evaluated standalone. Those carry `notEvaluable` and are
 *     checked by PRESENCE only: a copy appearing or vanishing is reported, a
 *     copy drifting is not.
 *   - The corpus is what the database holds, unioned with realistic raw shapes
 *     for the parsers that see input before it is stored. An input shape
 *     neither has sent yet is not tested, so agreement is evidence, not proof.
 *
 *   npx tsx scripts/check-concepts.ts
 *   npx tsx scripts/check-concepts.ts --verbose
 *   DB_PATH=/path/copy.db npx tsx scripts/check-concepts.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { CONCEPTS, NOT_SHARED, type Concept, type Impl } from '../lib/concepts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const VERBOSE = process.argv.includes('--verbose');
const SAMPLE = 5;

interface Problem { concept: string; what: string; rows: string[] }
const problems: Problem[] = [];

/**
 * The source text of one named function, from `function NAME` to its closing
 * brace. Read from the file every run, so an edit to either copy is what this
 * compares - the point of the whole check.
 */
function implSource(impl: Impl): string | null {
  const p = path.join(ROOT, impl.file);
  if (!fs.existsSync(p)) return null;
  const src = fs.readFileSync(p, 'utf8');
  const decl = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${impl.fn}\\s*\\(`, 'g');
  const m = decl.exec(src);
  if (!m) return null;
  const open = src.indexOf('{', m.index);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  return null;
}

/**
 * Strip TypeScript annotations far enough for `new Function` to accept it.
 *
 * Only the SIGNATURE is rewritten - everything from `function` to the opening
 * brace - plus `const x: T =` declarations inside the body. Running a blanket
 * `: Type` strip over the whole body would eat object literals, and this file's
 * whole point is that it runs the real bytes rather than a paraphrase.
 */
function toRunnable(source: string, fn: string): ((v: unknown) => unknown) | null {
  try {
    // `new Function` builds top-level script code, not a module - it rejects
    // a leading `export` (and would reject `export default`) even though the
    // declaration is otherwise a plain function. Implementations imported by
    // another module are naturally `export function`; implementations local
    // to a single script naturally are not. That is a visibility difference,
    // not a behavioural one, so it is stripped here rather than left to read
    // as "could not be evaluated" for a function that plainly can be.
    source = source.replace(/^export\s+(default\s+)?/, '');
    const open = source.indexOf('{');
    if (open < 0) return null;
    const TYPE = '[A-Za-z_$][A-Za-z0-9_$<>\\[\\].]*(?:\\s*\\|\\s*[A-Za-z_$][A-Za-z0-9_$<>\\[\\].]*)*';
    const sig = source.slice(0, open).replace(new RegExp(`:\\s*${TYPE}`, 'g'), '');
    const body = source.slice(open).replace(
      new RegExp(`\\b(const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*:\\s*${TYPE}`, 'g'),
      '$1 $2',
    );
    // eslint-disable-next-line no-new-func
    const factory = new Function(`${sig}${body}; return ${fn};`) as () => (v: unknown) => unknown;
    const f = factory();
    return typeof f === 'function' ? f : null;
  } catch {
    return null;
  }
}

function main() {
  const db = getDb();
  let inputsWalked = 0;
  let evaluated = 0;
  let presenceOnly = 0;
  let presenceOnlyImpls = 0;

  for (const c of CONCEPTS) {
    // Presence first, for every concept: a copy that vanished means the concept
    // may have been consolidated and this entry is stale; a file that moved
    // means the check has been silently reading nothing.
    const sources = new Map<string, string | null>();
    for (const impl of c.impls) sources.set(`${impl.file}:${impl.fn}`, implSource(impl));
    const missing = [...sources].filter(([, s]) => s == null).map(([k]) => k);
    if (missing.length) {
      problems.push({
        concept: c.name,
        what: `${missing.length} declared implementation(s) not found - the registry is describing code that is not there`,
        rows: missing,
      });
      continue;
    }

    if (c.notEvaluable) {
      presenceOnly++;
      const extra = findUndeclaredCopies(c);
      if (extra.length) {
        problems.push({
          concept: c.name,
          what: `${extra.length} implementation(s) exist that lib/concepts.ts does not list`,
          rows: extra,
        });
      }
      continue;
    }

    const runnable = new Map<string, (v: unknown) => unknown>();
    for (const [k, s] of sources) {
      const impl = c.impls.find((i) => `${i.file}:${i.fn}` === k)!;
      if (impl.notEvaluable) { presenceOnlyImpls++; continue; }
      const fnName = k.split(':')[1];
      const f = toRunnable(s as string, fnName);
      if (!f) {
        problems.push({
          concept: c.name,
          what: `${k} could not be evaluated standalone - declare notEvaluable in lib/concepts.ts rather than leaving it looking covered`,
          rows: [],
        });
      } else runnable.set(k, f);
    }
    if (runnable.size < 2) continue;
    evaluated++;

    const inputs = (db.prepare(c.corpusSql).all() as { v: unknown }[]).map((r) => r.v);
    inputsWalked += inputs.length;

    const keys = [...runnable.keys()];
    const disagreements: string[] = [];
    for (const input of inputs) {
      const outs = keys.map((k) => {
        try { return JSON.stringify(runnable.get(k)!(input)); } catch (e) { return `<threw: ${(e as Error).message}>`; }
      });
      if (new Set(outs).size > 1) {
        disagreements.push(
          `${JSON.stringify(String(input)).slice(0, 70)}  ->  `
          + keys.map((k, i) => `${k.split('/').pop()} = ${outs[i]}`).join('  vs  '),
        );
      }
    }
    if (disagreements.length) {
      problems.push({
        concept: c.name,
        what: `${disagreements.length} of ${inputs.length} real input(s) the ${keys.length} implementations answer differently - they meet at ${c.shared}`,
        rows: disagreements,
      });
    }

    const extra = findUndeclaredCopies(c);
    if (extra.length) {
      problems.push({
        concept: c.name,
        what: `${extra.length} implementation(s) exist that lib/concepts.ts does not list`,
        rows: extra,
      });
    }
  }

  const unregistered = findUndeclaredConcepts();
  console.log(`names implemented in 3+ files, outside app/, not a convention: ${unregistered.length} undeclared`);
  if (unregistered.length) {
    problems.push({
      concept: 'the registry itself',
      what: `${unregistered.length} idea(s) implemented in three or more files that lib/concepts.ts neither shares nor declares`,
      rows: unregistered,
    });
  }

  console.log(`concepts registered as sharing an output: ${CONCEPTS.length}`);
  console.log(`  compared behaviourally:  ${evaluated}`);
  console.log(`  checked by presence:     ${presenceOnly}`);
  console.log(`implementations read from source: ${CONCEPTS.reduce((n, c) => n + c.impls.length, 0)}`);
  console.log(`  of those, present but not runnable outside their module: ${presenceOnlyImpls}`);
  console.log(`real inputs run through every implementation: ${inputsWalked}`);
  console.log(`concepts declared NOT shared, with a reason: ${NOT_SHARED.length} (${NOT_SHARED.reduce((n, x) => n + x.impls, 0)} implementations)`);

  for (const p of problems) {
    console.error(`\n[${p.concept}] ${p.what}`);
    for (const r of p.rows.slice(0, VERBOSE ? p.rows.length : SAMPLE)) console.error(`    ${r}`);
    if (!VERBOSE && p.rows.length > SAMPLE) console.error(`    ... ${p.rows.length - SAMPLE} more (--verbose)`);
  }

  logRun('check-concepts', {
    status: problems.length ? 'partial' : 'success',
    items: CONCEPTS.length,
    error: problems.length ? problems.map((p) => `${p.concept}: ${p.what}`).join(' ; ').slice(0, 1000) : undefined,
  }, db);

  if (problems.length) {
    console.error(`\ncheck-concepts: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log('\ncheck-concepts: every implementation of a shared concept still gives the same answer');
}

/**
 * A copy of this concept's function living somewhere the registry does not name.
 *
 * The registry going stale downward - a copy appearing - is the failure mode
 * that matters, because the new copy is the one nobody will remember to fix.
 */
function findUndeclaredCopies(c: Concept): string[] {
  const declared = new Set(c.impls.map((i) => i.file));
  const otherIdea = new Set((c.sameNameDifferentIdea ?? []).map((e) => e.file));
  const out: string[] = [];
  const skip = new Set(['node_modules', '.next', '.next.prev', '.next.new', '.git', '.claude', 'data', 'public', 'brain', 'tests']);
  (function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      // Skip nested git worktrees/submodules (a `.git` at their root): they hold a
      // second copy of every implementation and would look like duplicate ideas.
      if (e.isDirectory()) { if (fs.existsSync(path.join(p, '.git'))) continue; walk(p); continue; }
      // `continue`, not `return`: a bare return here exits walk() entirely.
      if (!/\.tsx?$/.test(e.name)) continue;
      const rel = path.relative(ROOT, p);
      if (declared.has(rel) || otherIdea.has(rel)) continue;
      if (rel === 'scripts/check-concepts.ts' || rel === 'scripts/break-concepts.ts') continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const impl of c.impls) {
        if (new RegExp(`function\\s+${impl.fn}\\s*\\(`).test(src)) out.push(`${rel}: ${impl.fn}`);
      }
    }
  })(ROOT);
  return [...new Set(out)];
}

/**
 * A concept nobody registered at all.
 *
 * findUndeclaredCopies only looks for copies of concepts the registry already
 * names, so a NEW idea implemented three times is invisible to it.
 *
 * THE THRESHOLD, and why it is not "more than one". Three narrowings, each for
 * a stated reason:
 *
 *   >= 3 files    two copies of a helper is usually coincidence; three is a
 *                 pattern somebody is repeating on purpose
 *   not app/ or   GET, POST, generateMetadata and a default-exported component
 *   components/   per route are framework conventions, not duplication
 *   not a         `main` appears in dozens of scripts because that is the
 *   convention    entry point
 */
function findUndeclaredConcepts(): string[] {
  const MIN_FILES = 3;
  const CONVENTION = new Set(['main', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
    'generateMetadata', 'generateStaticParams', 'generateViewport', 'middleware']);
  const skip = new Set(['node_modules', '.next', '.next.new', '.next.prev', '.git', '.claude', 'data',
    'public', 'brain', 'tests', 'app', 'components']);

  const byName = new Map<string, Set<string>>();
  (function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (fs.existsSync(path.join(p, '.git'))) continue; walk(p); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      const rel = path.relative(ROOT, p);
      if (/^scripts\/(check|break)-/.test(rel)) continue;
      for (const m of fs.readFileSync(p, 'utf8')
        .matchAll(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[(<]/gm)) {
        let set = byName.get(m[1]);
        if (!set) { set = new Set(); byName.set(m[1], set); }
        set.add(rel);
      }
    }
  })(ROOT);

  const declared = new Set(
    [...CONCEPTS.map((c) => c.name), ...NOT_SHARED.map((n) => n.name)]
      .flatMap((n) => n.split(/[\s/()]+/))
      .filter(Boolean),
  );

  const out: string[] = [];
  for (const [name, files] of byName) {
    if (files.size < MIN_FILES || CONVENTION.has(name) || declared.has(name)) continue;
    out.push(`${name} - ${files.size} implementations: ${[...files].sort().join(', ')}`);
  }
  return out.sort();
}

main();
