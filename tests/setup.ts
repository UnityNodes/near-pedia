import '@testing-library/jest-dom';

/**
 * Isolation of the test suite from the outside world.
 *
 * WHY THIS EXISTS. tests/api/contact.test.ts once ran with lib/contact-webhook
 * unmocked, in a shell that had sourced .env.production. CONTACT_WEBHOOK_URL was
 * populated, so the fixture "Alice / alice@example.com" was posted twice into a
 * real channel. That was fixed by adding one vi.mock, which fixed one test and
 * left the shape untouched everywhere else.
 *
 * The same shape was still live in four more files. middleware.ts posts its
 * visit log to an ABSOLUTE https://nearpedia.example/api/log/visit, so tests/lib/
 * csp-header, error-reporting, analytics and image-hosts were inserting rows
 * into the PRODUCTION database on every run: 147 of them, each with a fresh
 * session id and no user-agent, and usage-counters scores agent_class IN
 * ('human','unknown') as human, so they landed in the visitor numbers that go
 * into grant applications. That path needs no credentials at all, which is why
 * a plain `npm test` in a clean shell was enough to do it.
 *
 * Per-instance mocking cannot close this. The next module to grow an outbound
 * call has the same reach and nothing announces it. So the default flips: no
 * credentials and no network unless a test asks, and asking is explicit.
 */

const ALLOW_LIVE_IO = process.env.ALLOW_LIVE_IO === '1';

/**
 * Environment names that can spend money, send something, or authenticate as us.
 *
 * Patterns rather than an enumerated list, deliberately: an enumerated list is
 * correct on the day it is written and silently incomplete from the next
 * integration onward. A new *_API_KEY or *_WEBHOOK_URL is covered the day it
 * lands rather than at the next audit.
 *
 * DB_PATH is intentionally NOT here. vitest.config.ts pins it to ':memory:' and
 * that pin is load-bearing; removing the value would hand the tests the real
 * data/nearpedia.db.
 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /_API_KEY$/,
  /_TOKEN$/,
  /_SECRET$/,
  /_WEBHOOK_URL$/,
  /_PASSWORD$/,
  /_PASS$/,
  /^SMTP_/,
  /^DISCOURSE_/,
  /^REDDIT_/,
  /^STACKEXCHANGE_/,
  /^TELEGRAM_/,
  /^NEYNAR_/,
  /^DEVTO_/,
  /^YOUTUBE_/,
  /^GITHUB_/,
  /^GH_/,
];

if (!ALLOW_LIVE_IO) {
  for (const name of Object.keys(process.env)) {
    if (CREDENTIAL_PATTERNS.some((p) => p.test(name))) delete process.env[name];
  }
}

/**
 * Deny the network by default.
 *
 * A REJECTED promise, not a synchronous throw. middleware.ts wraps its visit-log
 * post in `.catch(() => undefined)` because a failed log must never break a page
 * render; a synchronous throw walks straight past that catch and fails the test
 * for a reason that has nothing to do with what it is testing. A rejection is
 * refused by this guard and still handled by code written to tolerate a failed
 * request, which is exactly the line we want to draw.
 *
 * console.error keeps it visible. A blocked call that is swallowed by a tolerant
 * catch would otherwise leave a test looking green while proving nothing.
 *
 * Tests that genuinely exercise fetch already install their own stub via
 * vi.stubGlobal('fetch', ...) (discourse-client, stackexchange-client,
 * responder-mcp-client). Their stub replaces this one; they are unaffected.
 */
if (!ALLOW_LIVE_IO) {
  const blocked = (input: RequestInfo | URL): Promise<Response> => {
    const url =
      typeof input === 'string' ? input
      : input instanceof URL ? input.href
      : (input as Request).url;
    const msg =
      `[tests] blocked a real network request to ${url}. ` +
      `Mock the module, or install a stub with vi.stubGlobal('fetch', ...). ` +
      `ALLOW_LIVE_IO=1 disables this guard, and means what it says.`;
    console.error(msg);
    return Promise.reject(new Error(msg));
  };
  globalThis.fetch = blocked as unknown as typeof fetch;
}
