import { describe, it, expect } from 'vitest';
import { FOUNDATIONAL_SLUG, WHITEPAPER_META, formatPaperDate, newestFirst, paperFacts } from '@/lib/whitepaper-meta';
import type { WhitepaperMetaTable } from '@/lib/whitepaper-meta';

const TABLE: WhitepaperMetaTable = {
  'network-whitepaper': { publisher: 'Example Labs', date: '2024-01', dateNote: 'January 2024, on its title page' },
  'token-approach': { publisher: 'Example Labs', author: { name: 'Jane Doe', role: 'General Counsel' }, date: '2024-07-01', dateNote: 'July 1, 2024, in its first footnote' },
  'research-overview': { publisher: 'Example Research', author: { name: 'Alex Roe' }, date: '2026-05-20', dateNote: 'May 20, 2026, at the top of the report' },
  'technical-whitepaper': { publisher: 'Example Labs', author: { name: 'Protocol Team', organization: true }, date: '2020-02-04', dateNote: 'on its title page' },
};

const paper = (slug: string, pdf_url: string, description: string | null = 'From the sync.') => ({ slug, pdf_url, description });

describe('formatPaperDate', () => {
  it('shows as much of the date as the paper itself states', () => {
    expect(formatPaperDate('2024-01')).toBe('Jan 2024');
    expect(formatPaperDate('2024-07-01')).toBe('Jul 1, 2024');
    expect(formatPaperDate('2020')).toBe('2020');
  });

  it('answers a missing or malformed date with nothing', () => {
    expect(formatPaperDate(undefined)).toBe('');
    expect(formatPaperDate('July 2024')).toBe('');
    expect(formatPaperDate('2024-13')).toBe('2024');
  });
});

describe('paperFacts', () => {
  it('names the publisher and date from the table, and opens a PDF as a PDF', () => {
    const f = paperFacts(paper('network-whitepaper', 'https://www.yourchain.example/files/White%20Paper.pdf'), TABLE);
    expect(f).toMatchObject({ publisher: 'Example Labs', dateLabel: 'Jan 2024', sourceHost: 'yourchain.example', sourceAction: 'Open the PDF', isPdf: true, description: 'From the sync.' });
  });

  it('opens a web report on its host and names its author with their role', () => {
    expect(paperFacts(paper('research-overview', 'https://research.example.com/report/overview'), TABLE)).toMatchObject({ publisher: 'Example Research', authorLabel: 'Alex Roe', sourceAction: 'Open on research.example.com', isPdf: false });
    expect(paperFacts(paper('token-approach', 'https://x.example/a.pdf'), TABLE).authorLabel).toBe('Jane Doe, General Counsel');
  });

  it('falls back to the host for a paper the table does not hold, and states no date', () => {
    const f = paperFacts(paper('a-new-paper', 'https://www.yourchain.example/files/new.pdf?lang=en'), TABLE);
    expect(f).toMatchObject({ publisher: 'yourchain.example', date: null, dateLabel: '', isPdf: true });
  });
});

describe('newestFirst', () => {
  it('orders the papers by their own date, newest first, and undated papers last', () => {
    const ordered = newestFirst([...Object.keys(TABLE), 'a-new-paper'].map(slug => ({ slug })), TABLE).map(p => p.slug);
    expect(ordered).toEqual(['research-overview', 'token-approach', 'network-whitepaper', 'technical-whitepaper', 'a-new-paper']);
  });

  it('starts empty, so a new copy lists its papers by slug until it fills the table', () => {
    expect(Object.keys(WHITEPAPER_META)).toEqual([]);
    expect(FOUNDATIONAL_SLUG).toBeNull();
    expect(newestFirst([{ slug: 'b' }, { slug: 'a' }]).map(p => p.slug)).toEqual(['a', 'b']);
  });
});
