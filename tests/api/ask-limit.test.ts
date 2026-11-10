import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import http, { type Server } from 'http';
import { ASK_DAILY_MAX, ASK_HOURLY_MAX, askLimiters, limiter, tighter } from '@/lib/express-limits';

const HOUR_MS = 3_600_000;

function app() {
  const a = express();
  a.use('/api/v1', limiter(120, 15 * 60_000));
  a.use('/api/v1/ask', ...askLimiters());
  a.post('/api/v1/ask', (_req, res) => { res.json({ ok: true }); });
  a.get('/api/v1/other', (_req, res) => { res.json({ ok: true }); });
  return a;
}

let server: Server;
let base: string;

beforeEach(async () => {
  server = app().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  vi.useRealTimers();
  await new Promise((r) => server.close(r));
});

interface Reply { status: number; headers: http.IncomingHttpHeaders; body: unknown }

function call(method: string, route: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${route}`, { method }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end();
  });
}

const ask = () => call('POST', '/api/v1/ask');
const head = (r: Reply) => ({ limit: r.headers['ratelimit-limit'], remaining: r.headers['ratelimit-remaining'], policy: r.headers['ratelimit-policy'] });

describe('/api/v1/ask per-address limits', () => {
  it('has a daily sub-cap above the hourly one', () => {
    expect(ASK_HOURLY_MAX).toBe(30);
    expect(ASK_DAILY_MAX).toBe(40);
  });

  it('reports the ask limit in its headers, not the shared 120', async () => {
    const r = await ask();
    expect(r.status).toBe(200);
    expect(head(r)).toEqual({ limit: '30', remaining: '29', policy: '30;w=3600, 40;w=86400' });
    const other = await call('GET', '/api/v1/other');
    expect(other.headers['ratelimit-limit']).toBe('120');
  });

  it('stops at 30 in an hour, then at 40 in the day even after the hour resets', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
    for (let i = 0; i < ASK_HOURLY_MAX; i++) expect((await ask()).status).toBe(200);
    const blocked = await ask();
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ limit: 30, window: '1 hour' });
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(3600);

    vi.setSystemTime(new Date(Date.now() + HOUR_MS + 1000));
    const statuses: number[] = [];
    let last: Reply | null = null;
    for (let i = 0; i < ASK_DAILY_MAX - ASK_HOURLY_MAX; i++) {
      last = await ask();
      statuses.push(last.status);
    }
    expect(statuses.every((s) => s === 200)).toBe(true);
    expect(head(last!)).toMatchObject({ limit: '40', remaining: '0' });

    const daily = await ask();
    expect(daily.status).toBe(429);
    expect(daily.body).toMatchObject({ limit: 40, window: '24 hours' });
    expect(Number(daily.headers['retry-after'])).toBeGreaterThan(3600);
    expect(daily.headers['ratelimit-limit']).toBe('40');
  });
});

describe('tighter()', () => {
  it('picks the window with fewer requests left and counts its reset from now', () => {
    const now = Date.parse('2026-11-10T10:00:00Z');
    const h = tighter([
      { info: { key: 'a', limit: 30, used: 5, remaining: 25, resetTime: new Date(now + 600_000) }, windowMs: HOUR_MS },
      { info: { key: 'a', limit: 40, used: 35, remaining: 5, resetTime: new Date(now + 7_200_000) }, windowMs: 24 * HOUR_MS },
    ], now);
    expect(h).toMatchObject({ 'RateLimit-Limit': '40', 'RateLimit-Remaining': '5', 'RateLimit-Reset': '7200' });
  });
});
