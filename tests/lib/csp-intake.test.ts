// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
  admit,
  countOversized,
  intakeStats,
  normaliseReport,
  resetIntake,
  BUDGET_WINDOW_MS,
  DEDUPE_MS,
  MAX_FIELD_CHARS,
  MAX_PER_WINDOW,
} from '@/lib/csp-intake';

/**
 * /api/csp-report is an unauthenticated INSERT reachable from anywhere, and
 * the loudest caller after a deploy is not an attacker: an ad blocker trips
 * the policy on every page view, and each trip is a POST. Without these limits
 * one visitor writes a row per navigation and the csp_violations_24h gauge
 * Prometheus alerts on measures their extension instead of this site.
 */

const report = (over: Partial<Record<string, unknown>> = {}) => normaliseReport({
  'document-uri': 'https://example.test/page',
  'violated-directive': 'script-src',
  'blocked-uri': 'https://tracker.invalid/x.js',
  ...over,
});

describe('csp intake', () => {
  beforeEach(() => resetIntake());

  it('stores the first report and drops the repeat', () => {
    const t = 1_000_000;
    expect(admit(report(), t)).toBe('store');
    expect(admit(report(), t + 1_000)).toBe('duplicate');
    expect(intakeStats()).toMatchObject({ stored: 1, duplicate: 1 });
  });

  it('stores the same violation again once the window has passed', () => {
    const t = 1_000_000;
    expect(admit(report(), t)).toBe('store');
    expect(admit(report(), t + DEDUPE_MS + 1)).toBe('store');
  });

  it('treats a different page or a different rule as a different fact', () => {
    const t = 1_000_000;
    expect(admit(report(), t)).toBe('store');
    expect(admit(report({ 'document-uri': 'https://example.test/other' }), t)).toBe('store');
    expect(admit(report({ 'violated-directive': 'img-src' }), t)).toBe('store');
  });

  /** A flood is distributed and unique, so dedupe alone does not bound it. */
  it('stops inserting past the per-minute budget', () => {
    const t = 1_000_000;
    for (let i = 0; i < MAX_PER_WINDOW; i++) {
      expect(admit(report({ 'blocked-uri': `https://f${i}.invalid/x.js` }), t)).toBe('store');
    }
    expect(admit(report({ 'blocked-uri': 'https://one-too-many.invalid/x.js' }), t)).toBe('over-budget');
    expect(intakeStats().overBudget).toBe(1);
  });

  it('starts a fresh budget in the next window', () => {
    const t = 1_000_000;
    for (let i = 0; i < MAX_PER_WINDOW; i++) admit(report({ 'blocked-uri': `https://f${i}.invalid/x.js` }), t);
    expect(admit(report({ 'blocked-uri': 'https://later.invalid/x.js' }), t + BUDGET_WINDOW_MS + 1)).toBe('store');
  });

  it('truncates a field instead of storing a data: URI whole', () => {
    const huge = `data:text/javascript;base64,${'A'.repeat(50_000)}`;
    const f = report({ 'blocked-uri': huge });
    expect(f.blocked_uri!.length).toBe(MAX_FIELD_CHARS);
    expect(f.blocked_uri!.startsWith('data:text/javascript')).toBe(true);
  });

  it('keeps a missing or nonsense field out of the row rather than guessing', () => {
    const f = normaliseReport({ 'document-uri': '   ', 'line-number': 'not a number' });
    expect(f.document_uri).toBeNull();
    expect(f.line_number).toBeNull();
    expect(f.violated_directive).toBeNull();
  });

  it('accepts a line number and drops a negative one', () => {
    expect(normaliseReport({ 'line-number': 42 }).line_number).toBe(42);
    expect(normaliseReport({ 'line-number': -1 }).line_number).toBeNull();
  });

  it('survives a body that is not an object at all', () => {
    expect(() => normaliseReport(undefined)).not.toThrow();
    expect(normaliseReport('nonsense').document_uri).toBeNull();
  });

  /**
   * A drop that nobody can see is the failure this endpoint exists to avoid:
   * the violations gauge would look calm during the flood.
   */
  it('counts what it refuses', () => {
    countOversized();
    expect(intakeStats().oversized).toBe(1);
  });
});
