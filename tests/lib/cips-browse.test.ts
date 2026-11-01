import { describe, expect, it } from 'vitest';
import { CIP_PER_PAGE, CIP_SEARCH_SUGGESTIONS, IN_PROGRESS_STATUSES, activeFilters, inProgress, pageWindow } from '@/lib/cips-browse';
import { getCips } from '@/lib/cips';
import { formatDateLong } from '@/lib/utils';

describe('inProgress', () => {
  const counts = [{ status: 'Final', count: 56 }, { status: 'Draft', count: 11 }, { status: 'Proposed', count: 4 }, { status: 'In Review', count: 7 }, { status: 'Approved', count: 39 }];

  it('adds up the statuses that mean a proposal is still being worked on, and names each part', () => {
    const r = inProgress(counts);
    expect(r.total).toBe(22);
    expect(r.parts.map(p => p.status)).toEqual([...IN_PROGRESS_STATUSES]);
  });

  it('ignores a status that has no rows and counts nothing for an empty list', () => {
    expect(inProgress([{ status: 'Draft', count: 3 }]).total).toBe(3);
    expect(inProgress([]).total).toBe(0);
    expect(inProgress([]).parts).toEqual([]);
  });
});

describe('activeFilters', () => {
  it('lists every filter that is on, so each can be taken off on its own', () => {
    expect(activeFilters({})).toEqual([]);
    expect(activeFilters({ q: 'traffic', status: 'Draft', type: 'Tokenomics' })).toEqual([
      { key: 'q', label: 'Search', value: 'traffic' },
      { key: 'status', label: 'Status', value: 'Draft' },
      { key: 'type', label: 'Type', value: 'Tokenomics' },
    ]);
    expect(activeFilters({ q: '  ', status: '' })).toEqual([]);
  });
});

describe('pageWindow', () => {
  it('says which rows the page shows', () => {
    expect(pageWindow(1, 20, 136)).toEqual({ from: 1, to: 20 });
    expect(pageWindow(7, 16, 136)).toEqual({ from: 121, to: 136 });
    expect(pageWindow(1, 0, 0)).toEqual({ from: 0, to: 0 });
    expect(CIP_PER_PAGE).toBe(20);
  });
});

describe('suggestions', () => {
  it('offers few, distinct words', () => {
    expect(CIP_SEARCH_SUGGESTIONS.length).toBeGreaterThanOrEqual(3);
    expect(CIP_SEARCH_SUGGESTIONS.length).toBeLessThanOrEqual(5);
    expect(new Set(CIP_SEARCH_SUGGESTIONS).size).toBe(CIP_SEARCH_SUGGESTIONS.length);
  });

  it('takes the page size from the query that fills the page', () => {
    expect(typeof getCips).toBe('function');
  });
});

describe('formatDateLong', () => {
  it('prints the full year, so a two-digit year is never read as a day', () => {
    expect(formatDateLong('2026-10-07')).toBe('Oct 7, 2026');
    expect(formatDateLong('2026-10-23T03:15:11.765Z')).toBe('Oct 23, 2026');
  });

  it('keeps what a source says when it is not a date, and a dash for nothing', () => {
    expect(formatDateLong('TBD')).toBe('TBD');
    expect(formatDateLong(null)).toBe('-');
    expect(formatDateLong('2025-05-09 (reset 2025-08-13)')).toBe('2025-05-09 (reset 2025-08-13)');
  });
});
