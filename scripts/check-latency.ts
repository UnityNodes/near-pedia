/**
 * How long does an answer actually take?
 *
 * WHY THIS IS SEPARATE FROM check-deadlines. That check proves every outbound
 * call has a ceiling. A ceiling is not a speed: everything can be correctly
 * bounded and uniformly slow, and nothing would notice. This measures.
 *
 * It also catches the one regression a static check cannot see. The local
 * half of semantic_search is a brute-force scan: sqlite-vec compares the
 * query against every stored vector, so its cost rises with the corpus.
 * Nothing in the code changes as that number grows, so there is no diff to
 * review and no deadline to trip - the product just gets slower every week
 * the syncs do their job. The budgets below are what turn that into an event.
 *
 * BUDGETS ARE FOR REGRESSIONS, NOT FOR GRADING. Each is well above what the
 * tool needs today, because a check that flaps on a slow afternoon gets
 * ignored, and an ignored check is worse than no check. A breach should mean
 * something changed, not that the network was busy.
 *
 * Needs the MCP server. Unreachable is UNVERIFIED, never a pass, and a 429
 * is THROTTLED - being held back and being slow are different facts.
 *
 *   npx tsx scripts/check-latency.ts
 */

import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';

const BASE = process.env.MCP_URL ?? 'http://127.0.0.1:3041/mcp';

interface Probe {
  tool: string;
  args: Record<string, unknown>;
  budgetMs: number;
  why: string;
}

/**
 * Deliberately small: distinct SHAPES of work, not coverage of all ~40 tools.
 * Budgets measured live (get_cip 16ms, list_cips 13ms, search 35ms,
 * semantic_search unfiltered 449ms, filtered 201ms, learning_path 32ms,
 * get_recent_changes 27ms, ecosystem_dependency_graph 12ms) then set well
 * above, per the file header.
 */
const PROBES: Probe[] = [
  {
    tool: 'get_cip', args: { id: '0001' }, budgetMs: 750,
    why: 'single indexed row plus its formatting: the floor for anything this server does',
  },
  {
    tool: 'list_cips', args: { limit: 20 }, budgetMs: 750,
    why: 'a listing with a COUNT beside it, the shape most tools here share',
  },
  {
    tool: 'search', args: { query: 'getting started' }, budgetMs: 1500,
    why: 'FTS across the corpus, no network leg',
  },
  {
    tool: 'semantic_search', args: { query: 'how does node syncing work' }, budgetMs: 6000,
    why: 'the slow path by construction: OpenAI embed, then a brute-force vector scan over every chunk, then a Cohere rerank; this trips on a change of kind, not a slow day',
  },
  {
    // The same tool with an argument that changes its query plan, which is a
    // different shape of work and not a second sample of the line above -
    // A source_types filter is exactly the parameter that turned
    // free-on-the-vector-half into pathological on the FTS half while the
    // unfiltered probe alone stayed green.
    tool: 'semantic_search',
    args: { query: 'validator setup', source_types: ['forum_topic'], limit: 4 },
    budgetMs: 6000,
    why: 'semantic_search restricted to one source type: the filter runs inside both halves of the hybrid',
  },
  {
    tool: 'learning_path', args: { goal: 'run a node' }, budgetMs: 1500,
    why: 'multi-source fan-out: whitepaper, docs, CIPs, forum and talks assembled into one sequence',
  },
  {
    tool: 'get_recent_changes', args: {}, budgetMs: 1500,
    why: 'the cross-source timeline: CIP status changes, forum, blog and releases merged and ordered',
  },
  {
    tool: 'ecosystem_dependency_graph', args: { topic: 'wallets' }, budgetMs: 1500,
    why: 'a full aggregate walk over the ecosystem catalogue rather than a row fetch',
  },
];

/** Thrown for a 429 so a throttled run is not reported as an outage. */
class RateLimited extends Error {}

async function timeTool(tool: string, args: Record<string, unknown>): Promise<number> {
  const t0 = performance.now();
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 429) throw new RateLimited(`retry after ${res.headers.get('RateLimit-Reset') ?? '?'}s`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const body = await res.text();
  const elapsed = performance.now() - t0;

  // A tool that errored returns fast and would otherwise look like a great
  // score. Read the envelope before believing the clock.
  for (const line of body.split('\n')) {
    const l = line.startsWith('data: ') ? line.slice(6) : line;
    if (!l.trim().startsWith('{')) continue;
    const parsed = JSON.parse(l) as { result?: { isError?: boolean } };
    if (parsed.result?.isError) throw new Error('tool returned an error result');
    return elapsed;
  }
  throw new Error('unparseable response');
}

async function main(): Promise<void> {
  const db = getDb();
  const over: string[] = [];
  const unverified: string[] = [];
  const timings: number[] = [];
  let throttled = '';

  for (const p of PROBES) {
    let ms: number;
    try {
      ms = await timeTool(p.tool, p.args);
    } catch (err) {
      if (err instanceof RateLimited) {
        throttled = `rate-limited at ${p.tool} (${(err as Error).message})`;
        break;
      }
      unverified.push(`${p.tool}: ${(err as Error).message}`);
      continue;
    }

    timings.push(ms);
    const verdict = ms > p.budgetMs ? 'OVER' : 'ok  ';
    console.log(`  ${verdict}    ${p.tool.padEnd(22)} ${ms.toFixed(0).padStart(6)}ms  budget ${p.budgetMs}ms`);
    if (ms > p.budgetMs) {
      over.push(`${p.tool} took ${ms.toFixed(0)}ms against a ${p.budgetMs}ms budget (${p.why.slice(0, 90)})`);
    }
  }

  const slowest = timings.length ? Math.max(...timings) : 0;
  console.log(
    `[check-latency] ${timings.length} of ${PROBES.length} probe(s) timed, ` +
    `${over.length} over budget, ${unverified.length} unverified, slowest ${slowest.toFixed(0)}ms` +
    (throttled ? ', stopped early on the rate limiter' : ''),
  );
  for (const o of over) console.error(`  OVER        ${o}`);
  for (const u of unverified) console.error(`  UNVERIFIED  ${u}`);
  if (throttled) {
    console.error(`  THROTTLED   ${throttled}`);
    console.error('              not an outage and not a pass: the probes after this one went untimed');
  }

  const failures = over.length + unverified.length;
  logRun('check-latency', {
    status: over.length || unverified.length ? 'error' : throttled ? 'partial' : 'success',
    items: timings.length,
    error: [...over, ...unverified, ...(throttled ? [throttled] : [])].join(' ; ').slice(0, 1000) || undefined,
  }, db);

  if (failures || throttled) process.exitCode = 1;
}

main();
