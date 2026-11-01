/**
 * A run that did not finish must not be served, or counted, as one that did.
 *
 * THE CLASS. A bounded loop has two ways out and they are not the same event:
 * the work finished, or the ceiling was reached while there was more to do.
 * Code that does not separate them falls out of the bottom into the same
 * lines a completed run reaches, so a partial result is emitted as whole.
 *
 * WHAT THIS FOUND. lib/llm-cascade.ts's streamWithCascade had exactly this
 * shape, live: the loop over PROVIDERS caught a mid-stream provider failure
 * the same way it caught a pre-stream one - log it, `continue` to the next
 * provider. A provider that failed AFTER already yielding chunks to the
 * caller would fall through to a fresh provider, which streams a complete
 * answer from the top - the caller concatenates both and has no way to tell
 * a doubled answer from a normal one. Fixed alongside this check;
 * see lib/llm-cascade.ts's `committed` flag and cascadeOver().
 *
 * WHAT THIS WALKS. Every bounded loop in the serving path, against a
 * registry that says how each one ends. The surface is small, so the value
 * here is not breadth, it is the tripwire: an undeclared bounded loop is the
 * next instance arriving, and it is the one nobody is looking for.
 *
 * The second half asserts the mapping the first half cannot see: knowing a
 * committed cascade provider failed is worth nothing if the caller still
 * gets a chunk stream indistinguishable from success.
 *
 *   npx tsx scripts/check-completion.ts
 */

import fs from 'node:fs';
import { logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { repoPath } from '../lib/repo-root';
import { stripJsComments } from '../lib/strip-comments';
import { cascadeOver, type ProviderSpec, type CascadeChunk } from '../lib/llm-cascade';

/** Files that build an answer for a caller. A loop here can truncate one. */
const SERVING = [
  'mcp-server.ts',
  'lib/llm-cascade.ts',
  'lib/embeddings.ts',
  'lib/retry.ts',
  'lib/reranker.ts',
  'lib/vector-store.ts',
  'lib/search.ts',
];

interface Site {
  file: string;
  /** Text that identifies the loop, so a moved line does not break the match. */
  loop: string;
  /**
   * How exhaustion leaves the loop.
   *   throws     the caller gets an error, so nothing partial is served
   *   reported   the loop returns which ending happened and the caller acts
   *   bounded-by-data  the ceiling is the size of what is being walked, so
   *                    "exhaustion" IS completion
   */
  exhaustion: 'throws' | 'reported' | 'bounded-by-data';
  why: string;
}

const SITES: Site[] = [
  {
    file: 'lib/retry.ts',
    loop: 'for (let attempt = 0; attempt <= delays.length; attempt++)',
    exhaustion: 'throws',
    why: 'withRetry rethrows lastError once the attempts are spent, so a failed embedding can never be returned as a vector',
  },
  {
    file: 'mcp-server.ts',
    loop: 'for (let i = 0; i < columns.length; i++)',
    exhaustion: 'bounded-by-data',
    why: 'walks the column list to build a WHERE clause; running out of columns is the job finishing',
  },
  {
    file: 'lib/search.ts',
    loop: 'for (let i = 0; out.length < results.length; i++)',
    exhaustion: 'bounded-by-data',
    why: 'round-robins buckets whose combined size equals results.length; the loop cannot run out before out is full, because every result was bucketed first',
  },
];

async function collect(providers: ProviderSpec[]): Promise<{ chunks: CascadeChunk[]; error: string | null }> {
  const chunks: CascadeChunk[] = [];
  try {
    for await (const c of cascadeOver(providers, { maxTokens: 10, temperature: 0, messages: [{ role: 'user', content: 'x' }] })) {
      chunks.push(c);
    }
    return { chunks, error: null };
  } catch (err) {
    return { chunks, error: err instanceof Error ? err.message : String(err) };
  }
}

function fakeProvider(name: string, behavior: 'answers' | 'fails-before-first' | 'fails-mid-stream'): ProviderSpec {
  return {
    name,
    isConfigured: () => true,
    stream: async function* () {
      if (behavior === 'fails-before-first') throw new Error(`${name}: pre-stream failure`);
      yield 'first chunk ';
      if (behavior === 'fails-mid-stream') throw new Error(`${name}: mid-stream failure`);
      yield 'second chunk';
    },
  };
}

async function main(): Promise<void> {
  const problems: Array<{ kind: string; what: string }> = [];
  const lines: string[] = [];

  // ── half 1: every bounded loop in the serving path is declared ─────────────
  const declared = new Map(SITES.map(s => [`${s.file}::${s.loop}`, s]));
  const found: string[] = [];
  for (const rel of SERVING) {
    let src: string;
    try { src = stripJsComments(fs.readFileSync(repoPath(rel), 'utf8')); } catch { continue; }
    for (const raw of src.split('\n')) {
      const line = raw.trim();
      // A ceiling loop: a counter starting at 0 and compared to something. The
      // `for (const x of xs)` form cannot overrun, so it is not this class.
      const m = line.match(/for\s*\(\s*(?:let|var)\s+\w+\s*=\s*0\s*;[^)]*\)/);
      if (!m) continue;
      const loop = m[0];
      found.push(`${rel}::${loop}`);
      if (declared.has(`${rel}::${loop}`)) continue;
      problems.push({
        kind: 'undeclared-loop',
        what: `${rel} has a bounded loop no site declares: ${loop}. Say how it ends (throws / reported / bounded-by-data), or the next instance of this class arrives unnoticed.`,
      });
    }
  }
  for (const key of declared.keys()) {
    if (!found.includes(key)) {
      problems.push({ kind: 'stale-registry', what: `the registry declares ${key} but no such loop exists; re-point it rather than dropping it` });
    }
  }
  lines.push(`  ok    loops         ${found.length} bounded loop(s) across ${SERVING.length} serving file(s), all declared`);

  // ── half 2: a committed cascade provider is believed, not raced past ───────
  const clean = await collect([fakeProvider('p1', 'answers')]);
  if (clean.error || clean.chunks.map(c => c.text).join('') !== 'first chunk second chunk') {
    problems.push({ kind: 'ending-lost', what: `a provider that answers cleanly should stream both chunks with no error; got error=${clean.error} chunks=${JSON.stringify(clean.chunks)}` });
  }

  const failover = await collect([fakeProvider('p1', 'fails-before-first'), fakeProvider('p2', 'answers')]);
  if (failover.error || failover.chunks.length === 0 || failover.chunks[0].provider !== 'p2') {
    problems.push({ kind: 'ending-lost', what: `a pre-stream failure on the first provider should fall through cleanly to the next; got error=${failover.error} chunks=${JSON.stringify(failover.chunks)}` });
  }

  const midStream = await collect([fakeProvider('p1', 'fails-mid-stream'), fakeProvider('p2', 'answers')]);
  const gotBothProviders = new Set(midStream.chunks.map(c => c.provider)).size > 1;
  if (!midStream.error || gotBothProviders) {
    problems.push({
      kind: 'unguarded-fallthrough',
      what: `a provider that fails AFTER its first chunk must abort the whole stream as an error, never fall through to a fresh provider (the client would concatenate a truncated answer with a complete one). Got error=${midStream.error} chunks=${JSON.stringify(midStream.chunks)}`,
    });
  }

  if (!problems.some(p => p.kind === 'ending-lost' || p.kind === 'unguarded-fallthrough')) {
    lines.push('  ok    cascade       a committed provider failure aborts as an error; an uncommitted one still falls through');
  }

  for (const l of lines) console.log(l);
  for (const p of problems) console.error(`  [${p.kind}] ${p.what}`);

  logRun('completion', {
    status: problems.length ? 'error' : 'success',
    items: found.length + 3,
    error: problems.length
      ? `${problems.length} completion problem(s): ` + problems.slice(0, 3).map(p => `${p.kind} ${p.what.slice(0, 90)}`).join(' | ')
      : undefined,
  });

  console.log(
    problems.length
      ? `[check-completion] ${problems.length} problem(s) over ${found.length} bounded loop(s)`
      : `[check-completion] ${found.length} bounded loop(s) declare how they end, and a committed cascade provider is never raced past by a fresh one`,
  );
  if (problems.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  main().catch(err => { console.error('check-completion failed:', err); process.exit(1); });
}
