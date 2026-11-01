export const RELEASES_PER_PAGE = 100;
export const PAGE_ATTEMPTS = 5;

export function hasNextPage(linkHeader: string | null): boolean {
  return /<[^>]+>;\s*rel="next"/.test(linkHeader ?? '');
}

export function pageIsUnreliable(page: number, count: number, perPage: number, hasNext: boolean, known: number, previousHadNext = false): boolean {
  if (count < perPage && hasNext) return true;
  if (count === 0 && previousHadNext) return true;
  return page === 1 && count === 0 && known > 0;
}
