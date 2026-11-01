/**
 * Can anything a visitor touches wait forever?
 *
 * WHY. Every other check here asks whether the data is right. None asks
 * whether the answer arrives. The retrieval and generation code (lib/embeddings.ts,
 * lib/llm-cascade.ts, lib/reranker.ts) makes external calls to OpenAI,
 * Gemini and Cohere from request paths such as semantic_search and the
 * TL;DR endpoint, and every vendor SDK defaults to
 * a timeout measured in MINUTES with its own retry layer on top - OpenAI to
 * 10 minutes with 2 retries, Cohere to 2 retries with a 60s Retry-After cap.
 * Nothing here sets one unless it's written explicitly, so the real ceiling
 * on a slow request is whatever the vendor picked, multiplied by however
 * many retry layers happen to be stacked - and none of it surfaces as an
 * error, so a check that only looks for a thrown error stays green while a
 * visitor waits. This shape has been found live
 * (a rate-limited key's Retry-After backoff billed as latency, three real
 * answers taking 11-39 seconds with nothing logged as broken).
 *
 * WHAT MAKES IT A CLASS. This is not a property of any one call site; it's
 * the default everywhere, so the fix has to be checked everywhere. Two of
 * the four call sites first found were SDK methods, not
 * fetch() - a check that only grepped for fetch would report a clean sweep
 * while the defect it exists to catch sat untouched.
 *
 * REACHABILITY IS THE POINT. A sync script that hangs is a stuck cron job
 * and the next tick fixes it. A request path that hangs is a person
 * waiting. So this walks the import graph out from the actual entry points
 * - mcp-server.ts and every app/api route - rather than scanning the whole
 * tree.
 *
 *   npx tsx scripts/check-deadlines.ts
 */

import { readFileSync } from 'node:fs';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { stripJsComments as code } from '../lib/strip-comments';
import { sourceFiles, reachableFrom, isRequestEntry } from '../lib/reachability';

const ROOT = process.cwd();

/**
 * Outbound calls that cross the network. Adding an SDK means adding it here.
 * No anthropic entry: nearpedia's cascade (lib/llm-cascade.ts) is
 * gemini -> groq -> groq -> openai, all OpenAI-SDK-compatible or Gemini's
 * own client - no Anthropic SDK call site exists to check.
 */
const OUTBOUND: Array<{ re: RegExp; what: string }> = [
  { re: /\bfetch\s*\(/g, what: 'fetch' },
  { re: /\.(?:chat\.completions|embeddings)\.create\s*\(/g, what: 'openai/groq' },
  { re: /\.rerank\s*\(/g, what: 'cohere' },
  { re: /\.getGenerativeModel(?:FromCachedContent)?\s*\(/g, what: 'gemini' },
];

/** Anything that bounds the wait, however the SDK spells it. */
const DEADLINE = /\btimeout\s*:|timeoutInSeconds\s*:|AbortSignal\.timeout|\bsignal\s*:/;

/**
 * Call sites that legitimately have no deadline, with the reason. A blanket
 * pardon for a whole file would let the next unbounded call in that file
 * through unnoticed, so these name one site each.
 */
const DECLARED: Record<string, string> = {};

const rel = (p: string) => p.slice(ROOT.length + 1);

/**
 * The whole call expression, by matching parens from the opening one. A
 * deadline is usually an option object several lines below the call, so
 * looking at the single line the call starts on finds almost nothing.
 */
function callText(src: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < src.length && i < openIdx + 4000; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  return src.slice(openIdx, openIdx + 4000);
}

function main(): void {
  const db = getDb();
  // The walk and the entry predicate are shared with check-deployed, which
  // asks the same question for a different entry set.
  const all = sourceFiles(ROOT);
  const entries = all.filter(p => isRequestEntry(rel(p)));
  const reachable = reachableFrom(entries, ROOT);

  const unbounded: string[] = [];
  const staleDeclarations = new Set(Object.keys(DECLARED));
  let bounded = 0;
  let declared = 0;

  for (const f of [...reachable].sort()) {
    const src = code(readFileSync(f, 'utf8'));
    for (const { re, what } of OUTBOUND) {
      re.lastIndex = 0;
      for (const m of src.matchAll(re)) {
        const openIdx = src.indexOf('(', m.index! + m[0].length - 1);
        if (openIdx === -1) continue;
        // `function fetch`, `typeof fetch` and the like are not calls.
        const before = src.slice(Math.max(0, m.index! - 24), m.index!);
        if (/function\s+$|typeof\s+$|\.\s*$/.test(before)) continue;

        const line = src.slice(0, m.index!).split('\n').length;
        const site = `${rel(f)}:${line}`;

        if (DECLARED[site]) { declared++; staleDeclarations.delete(site); continue; }
        if (DEADLINE.test(callText(src, openIdx))) bounded++;
        else unbounded.push(`${site.padEnd(46)} ${what}`);
      }
    }
  }

  console.log(
    `[check-deadlines] ${entries.length} entry point(s), ${reachable.size} module(s) reachable from a request; ` +
    `${bounded} outbound call(s) bounded, ${declared} declared, ${unbounded.length} unbounded`,
  );
  for (const u of unbounded) console.error(`  UNBOUNDED   ${u}`);
  for (const s of staleDeclarations) {
    console.error(`  STALE       ${s} is declared here but is no longer an outbound call site`);
  }

  const failures = unbounded.length + staleDeclarations.size;
  logRun('check-deadlines', {
    status: failures ? 'error' : 'success',
    items: bounded + declared,
    error: [
      ...unbounded.map(u => `unbounded: ${u.trim()}`),
      ...[...staleDeclarations].map(s => `stale declaration: ${s}`),
    ].join(' ; ').slice(0, 1000) || undefined,
  }, db);

  if (failures) process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error('check-deadlines failed:', err);
  logRun('check-deadlines', { status: 'error', error: String(err).slice(0, 500) });
  process.exit(1);
}
