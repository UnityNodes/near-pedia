/**
 * Embeddings from NEAR AI Cloud (OpenAI-compatible /v1/embeddings, run inside
 * a TEE), with the same NEARAI_API_KEY /ask uses. Qwen3-Embedding-0.6B
 * returns 1024 dimensions and does not support shortening them, so the
 * vector table is FLOAT[1024]; $0.01 per million tokens on 2026-11-02.
 *
 * Qwen3-Embedding is trained with an instruction on the query side only:
 * passages are embedded as they are, a search query with QUERY_INSTRUCT.
 */

import OpenAI from 'openai';
import { withRetry } from './retry';
import { NEARAI_BASE_URL } from './near-ai';
import { DIMENSIONS } from './embedding-dims';

export { DIMENSIONS };

export const DEFAULT_EMBED_MODEL = 'Qwen/Qwen3-Embedding-0.6B';
const QUERY_INSTRUCT = 'Instruct: Given a question about NEAR Protocol, retrieve passages that answer it\nQuery: ';

// The SDK's own default is a 10 MINUTE timeout with 2 retries - fine for a
// batch job, unusable for a person waiting on a search box. embedText is
// only ever interactive (semantic_search);
// embedBatch is only ever the nightly embedding build, where a slower
// ceiling doesn't cost anyone a wait.
const INTERACTIVE_TIMEOUT_MS = 5_000;
/** Three attempts with the default 0.5 s and 1.5 s waits fit inside this, as before the move to lib/retry. */
const INTERACTIVE_BUDGET_MS = 3 * INTERACTIVE_TIMEOUT_MS + 2_000;
const BATCH_TIMEOUT_MS = 120_000;

let _client: { key: string; client: OpenAI } | null = null;
function client(): OpenAI {
  const apiKey = process.env.NEARAI_API_KEY?.trim();
  if (!apiKey) throw new Error('NEARAI_API_KEY is not set');
  if (_client?.key !== apiKey) _client = { key: apiKey, client: new OpenAI({ apiKey, baseURL: NEARAI_BASE_URL }) };
  return _client.client;
}

const model = () => process.env.NEARAI_EMBED_MODEL?.trim() || DEFAULT_EMBED_MODEL;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * A chunk cut inside an emoji ends in half a surrogate pair. NEAR AI's
 * gateway rejects the whole batch as invalid JSON for it (OpenAI accepted
 * it), so each text is made well-formed before it is sent.
 */
export const wellFormed = (s: string): string => s.replace(LONE_SURROGATE, '\uFFFD');

export async function embedText(text: string): Promise<number[]> {
  const res = await withRetry(() =>
    client().embeddings.create(
      { model: model(), input: wellFormed(`${QUERY_INSTRUCT}${text.trim()}`) },
      { timeout: INTERACTIVE_TIMEOUT_MS },
    ),
    INTERACTIVE_BUDGET_MS,
  );
  return res.data[0].embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await client().embeddings.create({ model: model(), input: texts.map(wellFormed) }, { timeout: BATCH_TIMEOUT_MS });
  return [...res.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export interface EmbeddingProbe {
  ok: boolean;
  ms: number;
  error?: string;
}

const PROBE_TEXT = 'how do I run a node';

export async function probeEmbeddings(): Promise<EmbeddingProbe> {
  const start = Date.now();
  try {
    const vector = await embedText(PROBE_TEXT);
    const ms = Date.now() - start;
    if (vector.length !== DIMENSIONS) return { ok: false, ms, error: `returned ${vector.length} dimensions, the index holds ${DIMENSIONS}` };
    return { ok: true, ms };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}
