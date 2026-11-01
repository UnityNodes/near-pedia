// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';

process.env.DB_PATH = ':memory:';

import { POST } from '@/app/api/csp-report/route';
import { getDb, initSchema } from '@/lib/db';
import { intakeStats, resetIntake, MAX_BODY_BYTES } from '@/lib/csp-intake';

/**
 * The endpoint answers a browser that was told to post here by our own CSP, so
 * it always answers 204: there is nowhere to show an error, no reason to
 * retry, and a status that varied with what we stored would tell an unfriendly
 * caller which reports get through.
 */

function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return POST(new Request('https://example.test/api/csp-report', {
    method: 'POST',
    headers: { 'content-type': 'application/csp-report', ...headers },
    body,
  }));
}

const rows = () => (getDb().prepare('SELECT COUNT(*) as c FROM csp_violation_log').get() as { c: number }).c;

const REPORT = JSON.stringify({
  'csp-report': {
    'document-uri': 'https://example.test/page',
    'violated-directive': 'script-src',
    'blocked-uri': 'https://tracker.invalid/x.js',
  },
});

describe('POST /api/csp-report', () => {
  beforeEach(() => {
    resetIntake();
    initSchema(getDb());
    getDb().prepare('DELETE FROM csp_violation_log').run();
  });

  it('stores a violation', async () => {
    expect((await post(REPORT)).status).toBe(204);
    expect(rows()).toBe(1);
  });

  it('stores the same violation once, not once per page view', async () => {
    await post(REPORT);
    await post(REPORT);
    await post(REPORT);
    expect(rows()).toBe(1);
    expect(intakeStats().duplicate).toBe(2);
  });

  it('refuses an oversized body without parsing it, and says 204 anyway', async () => {
    const huge = JSON.stringify({ 'csp-report': { 'blocked-uri': `data:,${'A'.repeat(MAX_BODY_BYTES)}` } });
    expect((await post(huge)).status).toBe(204);
    expect(rows()).toBe(0);
    expect(intakeStats().oversized).toBe(1);
  });

  /** content-length is absent under chunked encoding and can simply be wrong. */
  it('measures the real bytes, not the declared ones', async () => {
    const huge = JSON.stringify({ 'csp-report': { 'blocked-uri': `data:,${'A'.repeat(MAX_BODY_BYTES)}` } });
    expect((await post(huge, { 'content-length': '10' })).status).toBe(204);
    expect(rows()).toBe(0);
    expect(intakeStats().oversized).toBe(1);
  });

  it('does not fall over on a body that is not JSON', async () => {
    expect((await post('not json at all')).status).toBe(204);
    expect(rows()).toBe(0);
  });

  it('stores a truncated field rather than a whole payload', async () => {
    await post(JSON.stringify({
      'csp-report': {
        'document-uri': 'https://example.test/page',
        'violated-directive': 'script-src',
        'blocked-uri': `data:text/javascript,${'A'.repeat(2_000)}`,
      },
    }));
    const stored = getDb().prepare('SELECT blocked_uri FROM csp_violation_log').get() as { blocked_uri: string };
    expect(stored.blocked_uri.length).toBeLessThanOrEqual(300);
  });
});
