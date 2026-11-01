import { describe, expect, it } from 'vitest';
import { hasNextPage, pageIsUnreliable } from '../../lib/github-pages';

describe('hasNextPage', () => {
  it('sees rel="next" among several links', () => {
    const link = '<https://api.github.com/repositories/1/releases?per_page=100&page=2>; rel="next", <https://api.github.com/repositories/1/releases?per_page=100&page=9>; rel="last"';
    expect(hasNextPage(link)).toBe(true);
  });

  it('is false on the last page, which carries only first and prev', () => {
    const link = '<https://api.github.com/repositories/1/releases?per_page=100&page=1>; rel="first", <https://api.github.com/repositories/1/releases?per_page=100&page=8>; rel="prev"';
    expect(hasNextPage(link)).toBe(false);
  });

  it('is false when there is no Link header at all', () => {
    expect(hasNextPage(null)).toBe(false);
    expect(hasNextPage('')).toBe(false);
  });
});

describe('pageIsUnreliable', () => {
  it('flags a short page that still has a next page', () => {
    expect(pageIsUnreliable(3, 40, 100, true, 1200)).toBe(true);
  });

  it('trusts a short page with no next page: that is the end of the history', () => {
    expect(pageIsUnreliable(3, 40, 100, false, 1200)).toBe(false);
  });

  it('trusts a full page', () => {
    expect(pageIsUnreliable(2, 100, 100, true, 1200)).toBe(false);
  });

  it('flags an empty first page for a repo we already hold releases for', () => {
    expect(pageIsUnreliable(1, 0, 100, false, 9)).toBe(true);
  });

  it('accepts an empty first page for a repo we hold nothing for', () => {
    expect(pageIsUnreliable(1, 0, 100, false, 0)).toBe(false);
  });

  it('does not treat an empty later page as unreliable by itself', () => {
    expect(pageIsUnreliable(4, 0, 100, false, 1200)).toBe(false);
  });

  it('flags an empty page that follows a page which said another one exists', () => {
    expect(pageIsUnreliable(7, 0, 100, false, 1200, true)).toBe(true);
  });

  it('accepts an empty page when the previous page said it was the last', () => {
    expect(pageIsUnreliable(7, 0, 100, false, 1200, false)).toBe(false);
  });

  it('does not flag a non-empty page after a page with a next link', () => {
    expect(pageIsUnreliable(7, 40, 100, false, 1200, true)).toBe(false);
  });
});
