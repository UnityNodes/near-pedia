import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError, politeFetch, politeGetJson, retryAfterMs } from '@/lib/polite-fetch';

const opts = { userAgent: 'test', delays: [1, 1], sleep: async () => {} };

afterEach(() => vi.unstubAllGlobals());

function stubFetch(...responses: Array<() => Response>) {
  const calls: RequestInit[] = [];
  let i = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(init);
    return responses[Math.min(i++, responses.length - 1)]();
  }));
  return calls;
}

describe('politeGetJson', () => {
  it('returns null on 404 without retrying', async () => {
    const calls = stubFetch(() => new Response('', { status: 404 }));
    expect(await politeGetJson('https://x/y', opts)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('retries a 5xx and returns the later body', async () => {
    const calls = stubFetch(() => new Response('', { status: 502 }), () => Response.json({ ok: 1 }));
    expect(await politeGetJson('https://x/y', opts)).toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
  });

  it('throws a 403 at once with its status', async () => {
    stubFetch(() => new Response('', { status: 403 }));
    await expect(politeGetJson('https://x/y', opts)).rejects.toMatchObject({ status: 403 });
  });

  it('sends the User-Agent and extra headers', async () => {
    const calls = stubFetch(() => Response.json({}));
    await politeGetJson('https://x/y', { ...opts, headers: { Accept: 'application/json' } });
    expect(calls[0].headers).toMatchObject({ 'User-Agent': 'test', Accept: 'application/json' });
  });
});

describe('rate limits', () => {
  it('gives up at once on a Retry-After longer than it may wait, marked as rate-limited', async () => {
    const slept: number[] = [];
    const calls = stubFetch(() => new Response('', { status: 429, headers: { 'retry-after': '3600' } }));
    const err = await politeGetJson('https://x/y', { ...opts, sleep: async (ms) => { slept.push(ms); }, maxRetryAfterMs: 60_000 }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 429, rateLimited: true });
    expect(calls).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it('waits out a short Retry-After and retries', async () => {
    const slept: number[] = [];
    const calls = stubFetch(() => new Response('', { status: 429, headers: { 'retry-after': '2' } }), () => Response.json({ ok: 1 }));
    expect(await politeGetJson('https://x/y', { ...opts, sleep: async (ms) => { slept.push(ms); } })).toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
    expect(slept).toEqual([2000]);
  });

  it('retries a 408 request timeout', async () => {
    const calls = stubFetch(() => new Response('', { status: 408 }), () => Response.json({ ok: 1 }));
    expect(await politeGetJson('https://x/y', opts)).toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
  });
});

describe('politeFetch conditional requests', () => {
  it('sends If-None-Match and reports a 304 as not-modified', async () => {
    const calls = stubFetch(() => new Response(null, { status: 304 }));
    const r = await politeFetch('https://x/y', { ...opts, etag: 'W/"abc"' });
    expect(r.kind).toBe('not-modified');
    expect(calls[0].headers).toMatchObject({ 'If-None-Match': 'W/"abc"' });
  });

  it('hands back the ETag of a fresh answer', async () => {
    stubFetch(() => new Response('{}', { status: 200, headers: { etag: 'W/"new"' } }));
    const r = await politeFetch('https://x/y', opts);
    expect(r.kind === 'ok' && r.etag).toBe('W/"new"');
  });
});

describe('retryAfterMs', () => {
  it('reads seconds, and a default when the header is missing', () => {
    expect(retryAfterMs(new Response('', { headers: { 'retry-after': '3' } }))).toBe(3000);
    expect(retryAfterMs(new Response('', { headers: { 'retry-after': '999' } }))).toBe(999_000);
    expect(retryAfterMs(new Response(''))).toBe(10_000);
  });

  it('is exported with HttpError for callers that branch on status', () => {
    expect(new HttpError(500, 'u').status).toBe(500);
  });
});
