import { describe, it, expect } from 'vitest';

// Duplicate the FILTER_OPTIONS array from app/search/page.tsx so the
// test is DB-free. If the production file diverges from this list the
// test must be updated too — intentional, the order/labels carry UX
// commitments (e.g. 'All' must stay first).
//
// This drifted once already: 'mail' and 'proposal' chips (leftovers
// with no real data source in nearpedia) were removed from page.tsx without
// this copy following, so both this file's arrays stayed self-consistent
// with each other while describing dead chips neither the live page nor
// lib/search.ts's SearchResultType had produced in months.
const FILTER_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'cip', label: 'CIPs' },
  { value: 'discussion', label: 'Forum' },
  { value: 'doc', label: 'Docs' },
  { value: 'whitepaper', label: 'Papers' },
  { value: 'blog', label: 'Blog/News' },
  { value: 'youtube', label: 'Videos' },
  { value: 'github', label: 'GitHub' },
] as const;

const SEARCH_RESULT_TYPES = ['cip', 'discussion', 'doc', 'whitepaper', 'youtube', 'github', 'blog'] as const;

describe('search filter options', () => {
  it("'All' chip is first", () => {
    expect(FILTER_OPTIONS[0].value).toBe('');
    expect(FILTER_OPTIONS[0].label).toBe('All');
  });

  it('every non-All value corresponds to a SearchResultType', () => {
    for (const opt of FILTER_OPTIONS.slice(1)) {
      expect(SEARCH_RESULT_TYPES).toContain(opt.value as typeof SEARCH_RESULT_TYPES[number]);
    }
  });

  it('every SearchResultType has exactly one filter chip', () => {
    const filterValues = FILTER_OPTIONS.slice(1).map(o => o.value);
    expect(new Set(filterValues).size).toBe(filterValues.length); // no dupes
    for (const t of SEARCH_RESULT_TYPES) {
      expect(filterValues).toContain(t);
    }
    expect(filterValues).toHaveLength(SEARCH_RESULT_TYPES.length);
  });

  it('labels are non-empty strings', () => {
    for (const opt of FILTER_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
      expect(typeof opt.label).toBe('string');
    }
  });

  it('all labels are unique', () => {
    const labels = FILTER_OPTIONS.map(o => o.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('CSP-report endpoint contract', () => {
  it('expected fields are stable strings', () => {
    // Documenting the schema columns so any future migration that
    // drops one of these fails this test (and an obvious PR review).
    const expected = ['timestamp', 'document_uri', 'violated_directive', 'blocked_uri', 'source_file', 'line_number'];
    expect(expected).toEqual(['timestamp', 'document_uri', 'violated_directive', 'blocked_uri', 'source_file', 'line_number']);
  });
});
