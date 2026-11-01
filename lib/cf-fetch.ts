/**
 * Cloudflare-challenge bypass for forum.yourchain.example (Discourse) and
 * blog.yourchain.example (Ghost). The cf_clearance cookie is bound to the browser's
 * TLS/JA3 fingerprint, so replaying it via plain fetch/Playwright-request still
 * 403s. The only reliable path: a REAL headful Chrome (under xvfb) solves the
 * challenge once, then ALL requests go through in-page fetch() (page.evaluate)
 * so they share the same fingerprint + cf_clearance.
 *
 * Run sync scripts that use this under xvfb, e.g.:
 *   xvfb-run -a npx tsx scripts/sync-forum.ts
 */
import { chromium, type Browser, type Page } from 'playwright-core';

const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';

export interface CfSession {
  json<T = unknown>(path: string): Promise<T>;
  text(path: string): Promise<string>;
  close(): Promise<void>;
}

async function inPageFetch(page: Page, url: string): Promise<{ status: number; body: string }> {
  return page.evaluate(async (u) => {
    const r = await fetch(u, { headers: { accept: 'application/json, text/html, */*' }, credentials: 'include' });
    return { status: r.status, body: await r.text() };
  }, url);
}

function looksChallenged(s: string): boolean {
  return /Just a moment|cf-browser-verification|challenge-platform|_cf_chl_/i.test(s);
}

/**
 * Open a headful Chrome session against `origin`, solve the CF challenge, and
 * return helpers that fetch sub-paths through the same page. Re-solves on 403.
 */
export async function openCf(origin: string): Promise<CfSession> {
  const browser: Browser = await chromium.launch({
    executablePath: CHROME,
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();

  async function solve(): Promise<void> {
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // wait out the JS challenge — poll the title until it's no longer "Just a moment"
    for (let i = 0; i < 30; i++) {
      const title = await page.title().catch(() => '');
      const html = await page.content().catch(() => '');
      if (!/just a moment/i.test(title) && !looksChallenged(html)) return;
      await page.waitForTimeout(1500);
    }
  }
  await solve();

  async function get(path: string): Promise<string> {
    const url = path.startsWith('http') ? path : origin.replace(/\/$/, '') + path;
    let res = await inPageFetch(page, url);
    if (res.status === 403 || looksChallenged(res.body)) {
      await solve();
      res = await inPageFetch(page, url);
    }
    // Discourse rate-limits anon requests (429) — back off and retry.
    for (let attempt = 0; res.status === 429 && attempt < 5; attempt++) {
      await page.waitForTimeout(3000 * (attempt + 1));
      res = await inPageFetch(page, url);
    }
    if (res.status >= 400) throw new Error(`cf-fetch ${url} -> ${res.status}`);
    return res.body;
  }

  return {
    async json<T>(path: string): Promise<T> { return JSON.parse(await get(path)) as T; },
    text(path: string): Promise<string> { return get(path); },
    async close(): Promise<void> { await browser.close(); },
  };
}
