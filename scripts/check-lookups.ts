/**
 * A lookup's keys must exist in the vocabulary it indexes.
 *
 * THE CLASS. A hardcoded map indexed by a name that was derived somewhere else
 * has two vocabularies, and nothing makes them the same one. When the lookup
 * also carries a fall-through default, a total miss and a total hit print
 * identically, so the failure has no symptom at all.
 *
 * A staleness watchdog carried ~40 per-source freshness
 * thresholds keyed by SCRIPT name against a gauge labelled by sync_log
 * SOURCE name. Not one key ever matched. nearpedia hit this exact class
 * live in scripts/check-sync-staleness.sh (fixed separately - see
 * lib/schedule.ts) before this check existed to catch it generically.
 *
 * WHY THE SURFACE IS SMALL AND STAYS SMALL. Most lookups with a default
 * cannot hide a miss: `LABELS[t] ?? t` falls back to the raw value, so a
 * miss is legible in the output. Only a lookup whose default is a
 * plausible VALUE can hide, and those are worth declaring here with the
 * domain that has to cover them. Listing the harmless ones would be a
 * contract nobody signed.
 *
 * THE TWO SIDES ARE DIFFERENT FILES by construction: the keys come from the
 * map, the vocabulary from the code that produces the values being looked
 * up.
 *
 * PAIRS holds the sources widget's TYPE_MAP against the types
 * /api/v1/sources publishes.
 *
 *   npx tsx scripts/check-lookups.ts
 */

import fs from 'node:fs';
import { logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { repoPath } from '../lib/repo-root';
import { stripJsComments } from '../lib/strip-comments';

interface Pair {
  what: string;
  /** File and map name whose KEYS are the lookup's vocabulary. */
  lookup: { file: string; name: string };
  /** File whose values are the domain, and how to read them out. */
  domain: { file: string; re: RegExp; what: string };
  /** Keys that legitimately have no value in the domain, and why. */
  keysWithoutValues?: Record<string, string>;
}

const PAIRS: Pair[] = [
  {
    what: 'the sources widget on the home page and /sources drops a source type TYPE_MAP has no entry for, so an unmapped type vanishes from the page without a trace (NEPs did, 2026-11-05)',
    lookup: { file: 'components/sources-live.tsx', name: 'TYPE_MAP' },
    domain: { file: 'mcp-server.ts', re: /\{ type: '((?!embedding_chunk')[a-z_]+)',\s+desc:/g, what: 'source type /api/v1/sources publishes' },
  },
];

/** The keys of an object literal assigned to `name`, read from real source. */
function lookupKeys(file: string, name: string): string[] {
  const src = stripJsComments(fs.readFileSync(repoPath(file), 'utf8'));
  const at = src.indexOf(`const ${name}`);
  if (at === -1) throw new Error(`${file} has no ${name}`);
  const assign = src.indexOf('=', at);
  const open = assign === -1 ? -1 : src.indexOf('{', assign);
  const close = src.indexOf('};', open);
  if (open === -1 || close === -1) throw new Error(`${file}: could not read the body of ${name}`);
  const body = src.slice(open + 1, close);
  let depth = 0;
  let top = '';
  for (const ch of body) {
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (depth === 0) top += ch;
  }
  return [...new Set([...top.matchAll(/(?:^|[,\n])\s*['"]?([a-z_][a-z_0-9]*)['"]?\s*:/gi)].map(m => m[1]))];
}

async function main(): Promise<void> {
  const problems: Array<{ kind: string; what: string }> = [];
  const lines: string[] = [];
  let compared = 0;

  for (const p of PAIRS) {
    let keys: string[];
    try { keys = lookupKeys(p.lookup.file, p.lookup.name); } catch (e) {
      problems.push({ kind: 'unreadable', what: `${p.lookup.file}: ${(e as Error).message}` });
      continue;
    }
    const src = stripJsComments(fs.readFileSync(repoPath(p.domain.file), 'utf8'));
    const values = [...new Set([...src.matchAll(p.domain.re)].map(m => m[1]))];
    if (values.length === 0) {
      problems.push({ kind: 'empty-domain', what: `${p.domain.file}: read no ${p.domain.what} at all, so this comparison proves nothing` });
      continue;
    }
    compared++;

    for (const v of values) {
      if (keys.includes(v)) continue;
      problems.push({
        kind: 'value-without-key',
        what: `${p.domain.file} produces "${v}" (${p.domain.what}) and ${p.lookup.file}'s ${p.lookup.name} has no entry for it, so it takes the fall-through default and nothing reports the miss`,
      });
    }
    for (const k of keys) {
      if (values.includes(k)) continue;
      if (p.keysWithoutValues?.[k]) continue;
      problems.push({
        kind: 'key-without-value',
        what: `${p.lookup.file}'s ${p.lookup.name} has an entry for "${k}" that ${p.domain.file} never produces; the two vocabularies have drifted apart`,
      });
    }
    lines.push(`  ok    ${p.lookup.name.padEnd(12)} ${keys.length} key(s) against ${values.length} ${p.domain.what}(s): ${p.what}`);
  }

  for (const l of lines) console.log(l);
  for (const pr of problems) console.error(`  [${pr.kind}] ${pr.what}`);

  logRun('lookups', {
    // 'success' with items: 0 is indistinguishable from a run that examined
    // nothing (scripts/check-oracles.ts's O3, added alongside this fix,
    // exists exactly to catch that shape). PAIRS is legitimately empty right
    // now - see the docstring - so the honest status while it stays that way
    // is 'partial': the mechanism is armed and ran, but there is nothing yet
    // for it to have passed.
    status: problems.length ? 'error' : PAIRS.length === 0 ? 'partial' : 'success',
    items: PAIRS.length,
    error: problems.length
      ? `${problems.length} lookup problem(s): ` + problems.slice(0, 3).map(x => `${x.kind} ${x.what.slice(0, 90)}`).join(' | ')
      : undefined,
  });

  console.log(
    problems.length
      ? `[check-lookups] ${problems.length} problem(s) over ${PAIRS.length} lookup/domain pair(s)`
      : `[check-lookups] ${compared} of ${PAIRS.length} lookup(s) name every value the code they index actually produces`,
  );
  if (problems.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  main().catch(err => { console.error('check-lookups failed:', err); process.exit(1); });
}
