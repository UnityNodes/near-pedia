/**
 * Fetch for sync scripts: a User-Agent on every request, a per-request
 * timeout, retries inside a wall-clock budget, 429 honoured through
 * Retry-After, and 404 returned as null instead of thrown.
 *
 * Ported from Monpedia's lib/polite-fetch.ts, with request headers and
 * conditional requests added. A 304 skips the download and the write; it
 * spares GitHub rate-limit quota only on an authenticated request. Measured
 * 2026-11-01: ten unauthenticated conditional requests that all answered 304
 * took the remaining quota from 20 to 10.
 */

import { withRetry } from './retry';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
    readonly headers?: Headers,
    /** A 429 whose Retry-After was longer than the caller may wait; the caller should stop asking this host. */
    readonly rateLimited = false,
  ) {
    super(`${status} ${url}${rateLimited ? ` (rate limited, retry after ${headers?.get('retry-after') ?? '?'} s)` : ''}`);
  }
}

export interface PoliteOptions {
  userAgent: string;
  headers?: Record<string, string>;
  /** POST for JSON-RPC; GET when omitted. */
  method?: 'GET' | 'POST';
  body?: string;
  /** Sent as If-None-Match; a 304 answer comes back as `notModified`. */
  etag?: string | null;
  timeoutMs?: number;
  budgetMs?: number;
  delays?: number[];
  maxRetryAfterMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULTS = {
  timeoutMs: 20_000,
  budgetMs: 120_000,
  delays: [1_000, 4_000, 10_000, 20_000],
  maxRetryAfterMs: 60_000,
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * A 4xx other than 408 and 429 is the same on the second try; those two and a
 * 5xx are worth waiting for, unless the 429 already said to wait longer than
 * we may.
 */
export const isFatalStatus = (err: unknown): boolean => {
  if (err instanceof HttpError && err.rateLimited) return true;
  const status = (err as { status?: number })?.status;
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
};

export function retryAfterMs(res: Pick<Response, 'headers'>): number {
  const seconds = Number(res.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 10_000;
}

export type PoliteResponse =
  | { kind: 'ok'; res: Response; etag: string | null }
  | { kind: 'not-modified' }
  | { kind: 'not-found' };

async function attempt(url: string, opts: PoliteOptions): Promise<PoliteResponse> {
  const o = { ...DEFAULTS, ...opts };
  const sleep = opts.sleep ?? realSleep;
  const headers: Record<string, string> = { 'User-Agent': o.userAgent, ...(opts.headers ?? {}) };
  if (opts.etag) headers['If-None-Match'] = opts.etag;
  const res = await fetch(url, { method: opts.method ?? 'GET', body: opts.body, headers, signal: AbortSignal.timeout(o.timeoutMs) });
  if (res.status === 304) return { kind: 'not-modified' };
  if (res.status === 404) return { kind: 'not-found' };
  if (res.status === 429) {
    // Capping a one-hour Retry-After to a minute and asking again only spends
    // the next minute too; review worked out that sync-packages, looping over
    // sixty packages this way, could hold the slow bucket's cron lock for two
    // hours. Give up, and let the caller stop asking this host for the run.
    const wait = retryAfterMs(res);
    if (wait > o.maxRetryAfterMs) throw new HttpError(429, url, res.headers, true);
    await sleep(wait);
    throw new HttpError(429, url, res.headers);
  }
  if (!res.ok) throw new HttpError(res.status, url, res.headers);
  return { kind: 'ok', res, etag: res.headers.get('etag') };
}

/** The raw outcome, for callers that need the status kind, headers or ETag. */
export async function politeFetch(url: string, opts: PoliteOptions): Promise<PoliteResponse> {
  const o = { ...DEFAULTS, ...opts };
  return withRetry(() => attempt(url, opts), o.budgetMs, { delays: o.delays, fatal: isFatalStatus });
}

/**
 * The body read sits inside the retry: a connection dropped halfway through a
 * 1.4 MB llms-full.txt is the same transient failure as one dropped before
 * the headers, and is worth the same retry.
 */
async function readWith<T>(url: string, opts: PoliteOptions, read: (res: Response) => Promise<T>): Promise<T | null> {
  const o = { ...DEFAULTS, ...opts };
  return withRetry(async () => {
    const r = await attempt(url, { ...opts, etag: null });
    return r.kind === 'ok' ? await read(r.res) : null;
  }, o.budgetMs, { delays: o.delays, fatal: isFatalStatus });
}

/** Parsed JSON, or null on 404. Any other non-2xx, after the retry budget, throws. */
export function politeGetJson<T>(url: string, opts: PoliteOptions): Promise<T | null> {
  return readWith(url, opts, async (res) => (await res.json()) as T);
}

export function politeGetText(url: string, opts: PoliteOptions): Promise<string | null> {
  return readWith(url, opts, (res) => res.text());
}
