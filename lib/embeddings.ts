import OpenAI from 'openai';
import { withRetry } from './retry';

const OPENAI_MODEL = 'text-embedding-3-small';
export const DIMENSIONS = 1536;

// The SDK's own default is a 10 MINUTE timeout with 2 retries - fine for a
// batch job, unusable for a person waiting on a search box. embedText is
// only ever interactive (semantic_search);
// embedBatch is only ever the nightly embedding build, where a slower
// ceiling doesn't cost anyone a wait.
const INTERACTIVE_TIMEOUT_MS = 5_000;
/** Three attempts with the default 0.5 s and 1.5 s waits fit inside this, as before the move to lib/retry. */
const INTERACTIVE_BUDGET_MS = 3 * INTERACTIVE_TIMEOUT_MS + 2_000;
const BATCH_TIMEOUT_MS = 120_000;

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    _openai = new OpenAI({ apiKey });
  }
  return _openai;
}


export async function embedText(text: string): Promise<number[]> {
  const res = await withRetry(() =>
    getOpenAI().embeddings.create(
      {
        model: OPENAI_MODEL,
        input: text.trim(),
      },
      { timeout: INTERACTIVE_TIMEOUT_MS },
    ),
    INTERACTIVE_BUDGET_MS,
  );
  return res.data[0].embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await getOpenAI().embeddings.create(
    {
      model: OPENAI_MODEL,
      input: texts,
    },
    { timeout: BATCH_TIMEOUT_MS },
  );
  return res.data.map(d => d.embedding);
}

export async function embedTextVoyage(text: string): Promise<number[]> {
  // Dynamic import to avoid ESM resolution issues at module load time
  const { VoyageAIClient } = await import('voyageai');
  const client = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY ?? '' });
  const result = await client.embed({ input: [text], model: 'voyage-3-lite' });
  if (!result.data) throw new Error('No embedding data returned');
  return (result.data[0] as { embedding: number[] }).embedding;
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
