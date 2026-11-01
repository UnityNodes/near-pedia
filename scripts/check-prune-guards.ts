/**
 * A guard that refuses a deletion must be able to tell a rename from an outage.
 *
 * THE CLASS. `prune()` refuses a deletion over 25% of a source, because a blip
 * looks exactly like "upstream deleted everything". It has two cases and the
 * world has three: upstream is broken, upstream removed the page, and upstream
 * RENAMED it. A rename presents as a large deletion, so the guard refuses and
 * the renamed-away rows keep answering as current.
 *
 * This has happened: a documentation host renamed 26 of 83 reference pages,
 * the guard read that as a possible outage and refused for eight days, and
 * every check stayed green the whole time - the source synced, the rows were
 * full, the FTS index agreed with the table. A refusal is a correct answer to
 * the wrong question, which is why nothing downstream could see it.
 *
 * WHAT THIS WALKS. Every caller of `prune()`. A caller whose key is a URL can
 * ANSWER the question rather than guess at it, so it must go through
 * `pruneConfirmingUrls`. A caller keyed on something that is not fetchable owes
 * a declared reason instead. Undeclared is a failure: the fix for this class
 * gets written once, for the source that suffers the incident, and siblings
 * pruning into the same tables don't automatically get it.
 *
 * The surface is re-derived from the source on every run, so a new sync that
 * calls `prune()` and is named nowhere fails until somebody decides which of
 * the three registries it belongs in.
 *
 *   npx tsx scripts/check-prune-guards.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { repoPath } from '../lib/repo-root';
import { stripJsComments } from '../lib/strip-comments';

/**
 * A prune whose key cannot be fetched, and why confirmation is not available.
 *
 * These are not exemptions from the class, they are the answer to it: for
 * these sources "is this row really gone?" has no cheap HTTP answer, so the
 * ratio guard genuinely is the best available evidence and a refusal is the
 * right outcome.
 */
const NOT_URL_KEYED: Record<string, string> = {
  'sync-github-releases': 'keyed on the numeric GitHub release id, not a URL. The prune runs per repo only when the listing was paged to its last page, the mirrored blog_posts rows are pruned from the same listing, and prune() refuses an empty live set and a large share of the scope.',
  'sync-github-discussions': 'keyed on the GitHub discussion id, not a URL. The prune runs per repo only when the GraphQL pager reached the last page, and prune() refuses an empty live set and a large share of the scope.',
  'sync-youtube': 'keyed on the video id, not a URL. The playlist walk must have finished, every id the uploads playlist no longer lists is probed once through oEmbed and kept when it still resolves, and minDeleteAlways keeps the ratio guard on from the second row.',
};

/**
 * Scripts that generate files and never write a table. Their source can still
 * match the prune heuristics below by accident.
 */
const NOT_A_DB_WRITER = new Set<string>();

/** Callers that must route through pruneConfirmingUrls. */
const CONFIRMER = 'pruneConfirmingUrls';

/**
 * Raw set-difference prunes that read their NOT-IN set from THIS RUN'S FETCH,
 * and how each proves the fetch was complete before deleting. This is the
 * second shape of the class: `prune()` above is not the only way a sync
 * deletes by set difference. `DELETE FROM t WHERE id NOT IN (…fetched ids…)`
 * deletes every live row the run failed to read, so it owes a completeness
 * gate exactly as a confirming pruner owes a URL probe. Prunes whose NOT-IN
 * set is a SELECT subquery (retention by date, or an orphan sweep of another
 * table) are read from the database, cannot be emptied by a failed fetch,
 * and are not listed.
 */
const RAW_PRUNE_GUARDED: Record<string, string> = {};

/**
 * The THIRD shape of the class: the set difference computed in JavaScript
 * rather than SQL - `stored.filter(r => !seen.has(r.key))` then a per-row
 * DELETE, or `if (!seen.has(key)) del.run(...)`. Identical in danger to the
 * SQL NOT-IN above (the doomed set is this run's fetch, an incomplete fetch
 * deletes live rows) but invisible to the other two shapes: it imports no
 * prune helper and its NOT-IN never reaches SQL. A JS set-difference prune
 * must route through prune() or declare its own guard here.
 */
const JS_PRUNE_GUARDED: Record<string, string> = {
  'sync-docs': "keyed on url within the docs.yourchain.example namespace; an empty fetch throws before this code runs, and the delete-share is refused outright above 20% (process.exitCode=1, nothing deleted) rather than going through - narrower protection than pruneConfirmingUrls' per-URL 404 confirmation, but a genuine completeness gate, not a guess",
};

async function main(): Promise<void> {
  const problems: Array<{ kind: string; what: string }> = [];
  const lines: string[] = [];

  const dir = repoPath('scripts');
  const callers: Array<{ name: string; confirms: boolean }> = [];
  const rawPrunes: string[] = [];
  const jsSetPrunes: string[] = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.ts')) continue;
    // The surface is WRITERS. A check that scanned scripts/ wholesale found
    // itself, because its own failure message contains the word it greps for.
    if (file.startsWith('check-') || file.startsWith('break-')) continue;
    if (NOT_A_DB_WRITER.has(file.replace(/\.ts$/, ''))) continue;
    const src = stripJsComments(fs.readFileSync(path.join(dir, file), 'utf8'));
    const name = file.replace(/\.ts$/, '');

    // (a) lib/prune callers. Both halves are required, and each rules out a
    // different false positive. The import alone is not use; the token alone
    // is not this prune, since another local helper could share the name but
    // nothing else with it.
    if (/from '\.\.\/lib\/prune'/.test(src) && /\bprune\s*\(/.test(src)) {
      callers.push({ name, confirms: new RegExp(`\\b${CONFIRMER}\\s*\\(`).test(src) });
    }

    // (b) a fetch-set prune the pruner helper never sees. The vulnerable
    // ingredient is a NOT-IN membership test whose set is supplied by JS - a
    // `${…}` interpolation or a bound-`?` list - because that set is built
    // from THIS RUN'S fetch, and an incomplete fetch shrinks it into deleting
    // live rows. A `NOT IN (SELECT …)` reads from the DATABASE instead -
    // retention by date, an orphan sweep of another table - and a failed
    // fetch cannot empty it, so it is not this. Requiring a DELETE in the
    // same file keeps a NOT-IN used only to REPORT new rows out of the
    // surface.
    if (/\bNOT\s+IN\s*\(\s*(?:\$\{|\?)/i.test(src) && /\bDELETE\b/i.test(src)) {
      rawPrunes.push(name);
    }

    // (c) the same set difference computed in JS, in the two shapes it
    // takes: a doomed-set FILTER, `x.filter(r => !seen.has(r.key))`, and an
    // inline if-guarded delete, `if (!seen.has(k)) { …del.run… }`. The
    // ubiquitous `if (!m.has(k)) m.set(k,…)` memoization shares the `!has`
    // token but SETS rather than deletes, so it is excluded by requiring a
    // delete in the matched span, not merely somewhere in the file.
    const filterPrune = /\.filter\([^)]*!\s*\w+\.has\s*\(/.test(src) && /\bDELETE\b/i.test(src);
    const ifDeletePrune = /!\s*\w+\.has\s*\([^)]*\)\s*\)\s*\{[^{}]*?\b(?:DELETE|del\w*\.run)\b/i.test(src);
    if (filterPrune || ifDeletePrune) {
      jsSetPrunes.push(name);
    }
  }

  let confirming = 0;
  let declared = 0;
  for (const c of callers) {
    const why = NOT_URL_KEYED[c.name];
    if (c.confirms) {
      confirming++;
      if (why) {
        problems.push({
          kind: 'declared-but-confirms',
          what: `${c.name} is declared not-URL-keyed but does confirm; one of the two is stale, and a registry that disagrees with the code is worse than none`,
        });
      }
      continue;
    }
    if (why) { declared++; continue; }
    problems.push({
      kind: 'guesses',
      what: `${c.name} prunes without confirming and without a declared reason. If its key is a URL, route it through ${CONFIRMER} so a rename stops reading as an outage; if it is not, say so in NOT_URL_KEYED.`,
    });
  }

  for (const name of Object.keys(NOT_URL_KEYED)) {
    if (!callers.some(c => c.name === name)) {
      problems.push({ kind: 'stale-registry', what: `NOT_URL_KEYED names ${name}, which no longer calls prune(); re-point it rather than leaving it as false coverage` });
    }
  }

  // A fetch-set prune owes a declared completeness gate.
  let guardedFetch = 0;
  for (const name of rawPrunes) {
    if (RAW_PRUNE_GUARDED[name]) { guardedFetch++; continue; }
    problems.push({
      kind: 'raw-fetch-prune',
      what: `${name} deletes by a NOT-IN set built from this run's fetch, with no declared completeness gate; a partial or failed fetch would delete a live row. Gate it on "the fetch was complete" and declare how in RAW_PRUNE_GUARDED.`,
    });
  }
  for (const name of Object.keys(RAW_PRUNE_GUARDED)) {
    if (!rawPrunes.includes(name)) {
      problems.push({ kind: 'stale-registry', what: `RAW_PRUNE_GUARDED names ${name}, which no longer runs a fetch-set prune; re-point it rather than leaving it as false coverage` });
    }
  }

  // A JS set-difference prune owes the same completeness gate.
  let guardedJs = 0;
  for (const name of jsSetPrunes) {
    if (JS_PRUNE_GUARDED[name]) { guardedJs++; continue; }
    problems.push({
      kind: 'js-set-prune',
      what: `${name} deletes rows a JS Set.has() test says this run did not see, with no declared completeness gate; a partial or empty fetch deletes live rows. Route it through prune() or declare its guard in JS_PRUNE_GUARDED.`,
    });
  }
  for (const name of Object.keys(JS_PRUNE_GUARDED)) {
    if (!jsSetPrunes.includes(name)) {
      problems.push({ kind: 'stale-registry', what: `JS_PRUNE_GUARDED names ${name}, which no longer runs a JS set-difference prune; re-point it rather than leaving it as false coverage` });
    }
  }

  lines.push(`  ok    callers       ${callers.length} prune caller(s): ${confirming} confirm upstream, ${declared} declared not-URL-keyed`);
  lines.push(`  ok    fetch prunes  ${rawPrunes.length} writer(s) delete on a JS-supplied NOT-IN set: ${guardedFetch} declare a completeness gate`);
  lines.push(`  ok    js prunes     ${jsSetPrunes.length} writer(s) delete on a JS Set.has() difference: ${guardedJs} declare a completeness gate`);

  for (const l of lines) console.log(l);
  for (const p of problems) console.error(`  [${p.kind}] ${p.what}`);

  logRun('prune-guards', {
    status: problems.length ? 'error' : 'success',
    items: callers.length + rawPrunes.length + jsSetPrunes.length,
    error: problems.length
      ? `${problems.length} prune-guard problem(s): ` + problems.slice(0, 3).map(p => `${p.kind} ${p.what.slice(0, 90)}`).join(' | ')
      : undefined,
  });

  console.log(
    problems.length
      ? `[check-prune-guards] ${problems.length} problem(s) over ${callers.length} prune caller(s) and ${rawPrunes.length} fetch-set prune(s)`
      : `[check-prune-guards] ${confirming} of ${callers.length} prune caller(s) confirm upstream (${declared} declared); all ${rawPrunes.length} fetch-set prune(s) declare a completeness gate`,
  );
  if (problems.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  main().catch(err => {
    console.error('check-prune-guards failed:', err);
    logRun('prune-guards', { status: 'error', error: String(err).slice(0, 500) });
    process.exit(1);
  });
}
