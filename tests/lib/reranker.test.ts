// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rerank, rerankProvider, probeReranker, PROBE_PASSAGES } from '@/lib/reranker';

const candidates = [
  { chunkText: 'alpha' },
  { chunkText: 'bravo' },
  { chunkText: 'charlie' },
];

function cloudflareReply(response: Array<{ id: number; score: number }>, ok = true): Response {
  return new Response(JSON.stringify({ success: ok, result: ok ? { response } : null, errors: ok ? [] : [{ message: 'quota' }] }), {
    status: ok ? 200 : 429,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('rerank', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_AI_TOKEN;
    delete process.env.COHERE_API_KEY;
    delete process.env.NEARAI_API_KEY;
    delete process.env.NEARAI_RERANK_MODEL;
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('prefers Cloudflare when both of its variables are set, even with a Cohere key', () => {
    process.env.COHERE_API_KEY = 'cohere-test';
    expect(rerankProvider()).toBe('cohere');
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    expect(rerankProvider()).toBe('cohere');
    process.env.CLOUDFLARE_AI_TOKEN = 'cf-test';
    expect(rerankProvider()).toBe('cloudflare');
  });

  it('prefers NEAR AI Cloud over Cloudflare and Cohere when NEARAI_API_KEY is set', () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_AI_TOKEN = 'cf-test';
    process.env.COHERE_API_KEY = 'cohere-test';
    process.env.NEARAI_API_KEY = 'near-test';
    expect(rerankProvider()).toBe('nearai');
  });

  it('orders candidates by the NEAR AI relevance scores and keeps the ones it left out', async () => {
    process.env.NEARAI_API_KEY = 'near-test';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{ index: 2, relevance_score: 0.9 }, { index: 9, relevance_score: 0.99 }, { index: 0, relevance_score: 0.4 }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await rerank('which one', candidates, 3);

    expect(out.map(c => c.chunkText)).toEqual(['charlie', 'alpha', 'bravo']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://cloud-api.near.ai/v1/rerank');
    expect(init.headers.Authorization).toBe('Bearer near-test');
    expect(JSON.parse(init.body)).toEqual({ model: 'Qwen/Qwen3-Reranker-0.6B', query: 'which one', documents: ['alpha', 'bravo', 'charlie'] });
  });

  it('falls back to the input order when NEAR AI answers with an error', async () => {
    process.env.NEARAI_API_KEY = 'near-test';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 })));
    expect((await rerank('q', candidates)).map(c => c.chunkText)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('returns the input order when no reranker is configured', async () => {
    expect(rerankProvider()).toBeNull();
    expect(await rerank('q', candidates, 2)).toEqual(candidates.slice(0, 2));
  });

  it('orders candidates by the Cloudflare scores and sends every chunk', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_AI_TOKEN = 'cf-test';
    const fetchMock = vi.fn().mockResolvedValue(cloudflareReply([{ id: 2, score: 0.9 }, { id: 0, score: 0.5 }, { id: 1, score: 0.1 }]));
    vi.stubGlobal('fetch', fetchMock);

    const out = await rerank('which one', candidates, 3);

    expect(out.map(c => c.chunkText)).toEqual(['charlie', 'alpha', 'bravo']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/baai/bge-reranker-base');
    expect(init.headers.Authorization).toBe('Bearer cf-test');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({ query: 'which one', contexts: [{ text: 'alpha' }, { text: 'bravo' }, { text: 'charlie' }], top_k: 3 });
  });

  it('keeps candidates the reply left out, after the scored ones, and ignores ids out of range', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_AI_TOKEN = 'cf-test';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(cloudflareReply([{ id: 1, score: 0.8 }, { id: 7, score: 0.99 }, { id: 1, score: 0.2 }])));

    const out = await rerank('q', candidates);

    expect(out.map(c => c.chunkText)).toEqual(['bravo', 'alpha', 'charlie']);
  });

  it('cuts the reranked list to topN', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_AI_TOKEN = 'cf-test';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(cloudflareReply([{ id: 2, score: 0.9 }, { id: 0, score: 0.5 }, { id: 1, score: 0.1 }])));

    expect((await rerank('q', candidates, 1)).map(c => c.chunkText)).toEqual(['charlie']);
  });

  it('falls back to the input order when Cloudflare refuses', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_AI_TOKEN = 'cf-test';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(cloudflareReply([], false)));

    expect(await rerank('q', candidates, 2)).toEqual(candidates.slice(0, 2));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('fell back to RRF order'));
  });

  it('falls back to the input order when the request fails or times out', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_AI_TOKEN = 'cf-test';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError')));

    expect(await rerank('q', candidates)).toEqual(candidates);
  });

  it('does not call out for an empty pool', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_AI_TOKEN = 'cf-test';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await rerank('q', [])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('probe passes when the provider ranks the relevant passage first', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_AI_TOKEN = 'cf-test';
    const relevant = PROBE_PASSAGES.findIndex(p => p.relevant);
    const others = PROBE_PASSAGES.map((_, i) => i).filter(i => i !== relevant);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(cloudflareReply([{ id: relevant, score: 0.9 }, ...others.map(i => ({ id: i, score: 0.1 }))])));

    expect(await probeReranker()).toMatchObject({ provider: 'cloudflare', ok: true });
  });

  it('probe fails when the provider answers but ranks an irrelevant passage first', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_AI_TOKEN = 'cf-test';
    const relevant = PROBE_PASSAGES.findIndex(p => p.relevant);
    const other = PROBE_PASSAGES.findIndex(p => !p.relevant);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(cloudflareReply([{ id: other, score: 0.9 }, { id: relevant, score: 0.1 }])));

    const p = await probeReranker();
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/ranked first/);
  });

  it('probe fails with the reason when the provider refuses', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_AI_TOKEN = 'cf-test';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(cloudflareReply([], false)));

    const p = await probeReranker();
    expect(p).toMatchObject({ provider: 'cloudflare', ok: false });
    expect(p.error).toMatch(/HTTP 429: quota/);
  });

  it('probe fails when no reranker is configured, since semantic_search then runs unranked', async () => {
    expect(await probeReranker()).toMatchObject({ provider: null, ok: false });
  });
});

