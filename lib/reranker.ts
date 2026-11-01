/**
 * Reranking: Cloudflare Workers AI bge-reranker-base when CLOUDFLARE_ACCOUNT_ID
 * and CLOUDFLARE_AI_TOKEN are set, otherwise Cohere rerank-v3.5 when
 * COHERE_API_KEY is set.
 *
 * Sits between hybrid search and the answer of semantic_search:
 *   hybridSearch pool -> source_types filter -> rerank -> limit
 * From the project this template was cut from, where the measurements below were taken.
 *
 * If no provider is configured OR the call fails for any reason, we transparently
 * return the input candidates unchanged - the rest of the pipeline keeps working.
 *
 * WHY THE BOUNDS BELOW. That last sentence was the stated design and the code
 * did not enforce it. 270 real calls over a week ran a 383ms median and a 627ms
 * p90, and three of them took 10992ms, 13039ms and 38813ms. None of those three
 * FAILED - they returned results, late. The rate limit above is the reason: a
 * 429 carries a Retry-After, the SDK sleeps on it (up to MAX_RETRY_DELAY, 60s)
 * and retries twice by default, so exceeding our own quota is billed to whoever
 * is waiting on the answer. An optional quality booster that can block for 38
 * seconds is not optional, it is the critical path with extra steps.
 *
 * So: one attempt, hard deadline, fall back to the order we already have. The
 * input is RRF-ranked, not arbitrary, so the degraded answer is a good answer in
 * a slightly worse order - which beats a correct order nobody waited for.
 */

import { CohereClient } from 'cohere-ai';

/**
 * Deadline for the whole rerank call. ~5x the observed p90, so a normal slow
 * day never trips it and a rate-limited or stalled key cannot cost more than
 * this. Raising it trades user latency for ranking quality; that is the knob.
 */
const RERANK_TIMEOUT_MS = 3000;

const CLOUDFLARE_MODEL = '@cf/baai/bge-reranker-base';

type RerankCandidate = {
  chunkText: string;
};

export type RerankProvider = 'cloudflare' | 'cohere';

interface CloudflareConfig {
  account: string;
  token: string;
}

interface CloudflareReply {
  success?: boolean;
  result?: { response?: Array<{ id: number; score: number }> } | null;
  errors?: Array<{ message?: string }>;
}

let cachedClient: CohereClient | null = null;
let hasWarnedNoKey = false;

function cloudflareConfig(): CloudflareConfig | null {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_AI_TOKEN;
  return account && token ? { account, token } : null;
}

function cohereClient(): CohereClient | null {
  const key = process.env.COHERE_API_KEY;
  if (!key) return null;
  if (!cachedClient) cachedClient = new CohereClient({ token: key });
  return cachedClient;
}

async function cloudflareOrder<T extends RerankCandidate>(cfg: CloudflareConfig, query: string, candidates: T[]): Promise<T[]> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfg.account}/ai/run/${CLOUDFLARE_MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, contexts: candidates.map((c) => ({ text: c.chunkText })), top_k: candidates.length }),
    signal: AbortSignal.timeout(RERANK_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as CloudflareReply;
  const scored = body.result?.response;
  if (!res.ok || !body.success || !Array.isArray(scored)) {
    throw new Error(`Cloudflare HTTP ${res.status}${body.errors?.[0]?.message ? `: ${body.errors[0].message}` : ''}`);
  }
  const order = [...scored]
    .sort((a, b) => b.score - a.score)
    .map((r) => r.id)
    .filter((id, i, all) => Number.isInteger(id) && id >= 0 && id < candidates.length && all.indexOf(id) === i);
  const picked = new Set(order);
  return [...order.map((id) => candidates[id]), ...candidates.filter((_, i) => !picked.has(i))];
}

async function cohereOrder<T extends RerankCandidate>(client: CohereClient, query: string, candidates: T[], topN: number): Promise<T[]> {
  const resp = await client.rerank(
    {
      model: 'rerank-v3.5',
      query,
      documents: candidates.map((c) => c.chunkText),
      topN,
    },
    // maxRetries 0 is deliberate and is the half that actually fixes this.
    // The SDK's own retry is what turns a 429 into tens of seconds of
    // sleeping, and retrying a quota we have already exhausted cannot
    // succeed - it only decides who waits for the failure.
    { timeoutInSeconds: RERANK_TIMEOUT_MS / 1000, maxRetries: 0 },
  );
  return resp.results
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .map((r) => candidates[r.index]);
}

type ActiveReranker = {
  provider: RerankProvider;
  order: <T extends RerankCandidate>(query: string, candidates: T[], topN: number) => Promise<T[]>;
};

function activeReranker(): ActiveReranker | null {
  const cf = cloudflareConfig();
  if (cf) return { provider: 'cloudflare', order: (query, candidates) => cloudflareOrder(cf, query, candidates) };
  const cohere = cohereClient();
  if (cohere) return { provider: 'cohere', order: (query, candidates, topN) => cohereOrder(cohere, query, candidates, topN) };
  return null;
}

const PROBE_QUERY = 'How do validators agree on and finalize a new block?';

export const PROBE_PASSAGES: ReadonlyArray<RerankCandidate & { relevant: boolean }> = [
  { chunkText: 'Mix flour, water and salt, then let the sourdough rest overnight before baking.', relevant: false },
  { chunkText: 'Validators vote on a proposed block in rounds; once a quorum of stake signs it, the block is final and cannot be reverted.', relevant: true },
  { chunkText: 'The museum opens at nine on weekdays and closes early on public holidays.', relevant: false },
];

export function rerankProvider(): RerankProvider | null {
  return activeReranker()?.provider ?? null;
}

export interface RerankProbe {
  provider: RerankProvider | null;
  ok: boolean;
  ms: number;
  error?: string;
}

export async function probeReranker(): Promise<RerankProbe> {
  const active = activeReranker();
  if (!active) return { provider: null, ok: false, ms: 0, error: 'no reranker configured, so semantic_search runs unranked' };
  const start = Date.now();
  try {
    const ordered = await active.order(PROBE_QUERY, [...PROBE_PASSAGES], PROBE_PASSAGES.length);
    const ms = Date.now() - start;
    if (!ordered[0]?.relevant) return { provider: active.provider, ok: false, ms, error: 'the relevant passage was not ranked first' };
    return { provider: active.provider, ok: true, ms };
  } catch (err) {
    const ms = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return { provider: active.provider, ok: false, ms, error: ms >= RERANK_TIMEOUT_MS ? `over ${RERANK_TIMEOUT_MS}ms deadline` : msg };
  }
}

export type RerankFallbackListener = (provider: string, why: string) => void;

let fallbackListener: RerankFallbackListener | null = null;

export function onRerankFallback(listener: RerankFallbackListener | null): void {
  fallbackListener = listener;
}

/**
 * Rerank `candidates` by semantic relevance to `query`.
 *
 * Returns the same candidates reordered (best first), or the original order
 * if reranking is unavailable. NEVER throws - this is a quality booster, not a
 * critical-path dependency.
 *
 * @param topN  How many top results to return after reranking. Defaults to candidates.length.
 */
export async function rerank<T extends RerankCandidate>(
  query: string,
  candidates: T[],
  topN?: number,
): Promise<T[]> {
  if (candidates.length === 0) return candidates;
  const limit = topN ?? candidates.length;
  const active = activeReranker();
  if (!active) {
    if (!hasWarnedNoKey) {
      console.info('[reranker] no reranker configured (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN, or COHERE_API_KEY) - using boost-only ordering');
      hasWarnedNoKey = true;
    }
    return candidates.slice(0, limit);
  }
  const { provider } = active;

  const start = Date.now();
  try {
    const ordered = await active.order(query, candidates, limit);
    const shown = ordered.slice(0, limit);
    const elapsed = Date.now() - start;
    console.info(`[reranker] reranked ${candidates.length} -> top ${shown.length} in ${elapsed}ms (${provider})`);
    return shown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const elapsed = Date.now() - start;
    // Name the deadline separately from a real error. Both degrade to the same
    // ordering, but "we gave up on time" and "the provider said no" want different
    // reactions, and a week of journal lines that say only "failed" cannot tell
    // you which one you have.
    const why = elapsed >= RERANK_TIMEOUT_MS ? `over ${RERANK_TIMEOUT_MS}ms deadline` : msg;
    console.warn(`[reranker] fell back to RRF order after ${elapsed}ms (${provider}: ${why})`);
    try {
      fallbackListener?.(provider, why);
    } catch (listenerErr) {
      console.warn(`[reranker] fallback listener failed: ${listenerErr instanceof Error ? listenerErr.message : String(listenerErr)}`);
    }
    return candidates.slice(0, limit);
  }
}
