import { describe, expect, it } from 'vitest';
import { parseDateText, parseNext } from '@/lib/youtube-next';

const body = (primary: object, secondary: object) => ({
  contents: { twoColumnWatchNextResults: { results: { results: { contents: [
    { videoPrimaryInfoRenderer: primary },
    { videoSecondaryInfoRenderer: secondary },
  ] } } } },
});

describe('parseNext', () => {
  it('reads the title, the date and the full description', () => {
    const meta = parseNext(body(
      { title: { runs: [{ text: 'Maximizing Blockchain Efficiency ' }, { text: 'The Power of Aggregation' }] }, dateText: { simpleText: 'Apr 24, 2024' } },
      { attributedDescription: { content: 'Illia Polosukhin co-founder of NEAR\nHow platforms like NEAR and Solana are teaming up' } },
    ));
    expect(meta).toEqual({
      title: 'Maximizing Blockchain Efficiency The Power of Aggregation',
      description: 'Illia Polosukhin co-founder of NEAR\nHow platforms like NEAR and Solana are teaming up',
      published_at: '2024-04-24T00:00:00.000Z',
    });
  });

  it('answers nulls for a response without the watch results, such as a sign-in check', () => {
    expect(parseNext({ playabilityStatus: { status: 'LOGIN_REQUIRED' } })).toEqual({ title: null, description: null, published_at: null });
  });

  it('treats an empty description as none', () => {
    expect(parseNext(body({ title: { runs: [{ text: 'T' }] } }, { attributedDescription: { content: '   ' } })).description).toBeNull();
  });
});

describe('parseDateText', () => {
  it('reads plain, premiered and streamed dates', () => {
    expect(parseDateText('Apr 24, 2024')).toBe('2024-04-24T00:00:00.000Z');
    expect(parseDateText('Premiered Mar 3, 2025')).toBe('2025-03-03T00:00:00.000Z');
    expect(parseDateText('Streamed live on Nov 1, 2026')).toBe('2026-11-01T00:00:00.000Z');
  });

  it('gives null for a relative date or nothing', () => {
    expect(parseDateText('2 years ago')).toBeNull();
    expect(parseDateText(null)).toBeNull();
  });
});
