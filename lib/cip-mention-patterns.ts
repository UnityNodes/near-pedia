import { escLike } from './rank';

/**
 * Pure helper that builds the LIKE patterns used to find mentions of
 * a CIP across forum/mail/blog/proposal bodies.
 *
 * Two patterns are returned because the corpus mixes both forms:
 *   - 'CIP-0042'  - canonical zero-padded id as stored in cips.id
 *   - 'CIP-42'    - colloquial unpadded form in posts and PR titles
 *
 * The caller is expected to wrap them with '%…%' and OR-combine
 * across whichever columns it cares about - this helper just guarantees
 * the same id normalization rules every caller used to duplicate.
 */

export interface CipMentionPatterns {
  /** Zero-padded form, e.g. "CIP-0042" */
  padded: string;
  /** Unpadded form, e.g. "CIP-42" - null when id isn't numeric (PR-117) */
  unpadded: string | null;
  /** Numeric-only padded id, e.g. "0042" - for direct cip_id column joins */
  numericId: string;
}

export function cipMentionPatterns(cipId: string): CipMentionPatterns | null {
  if (typeof cipId !== 'string') return null;
  const trimmed = cipId.trim();
  if (!trimmed) return null;
  const stripped = trimmed.replace(/^CIP-/i, '');
  const isNumeric = /^\d+$/.test(stripped);
  const numericId = isNumeric ? stripped.padStart(4, '0') : stripped;
  const padded = `CIP-${numericId}`;
  const unpadded = isNumeric ? `CIP-${parseInt(numericId, 10)}` : null;
  return { padded, unpadded, numericId };
}

/**
 * Convenience: returns the two LIKE-ready '%pattern%' strings, with
 * a fallback so the unpadded copy is just '%CIP-…%' if unpadded
 * matches padded (e.g. CIP-9999 - no leading zeros to strip).
 */
export function cipMentionLikeStrings(cipId: string): { padded: string; unpadded: string } | null {
  const p = cipMentionPatterns(cipId);
  if (!p) return null;
  return {
    padded: `%${escLike(p.padded)}%`,
    unpadded: `%${escLike(p.unpadded ?? p.padded)}%`,
  };
}

/**
 * A reference to this CIP that is not part of a longer number.
 *
 * WHY. The LIKE patterns above are a substring test, and in a substring test a
 * number has no right edge. '%CIP-1%' matches CIP-10 through CIP-19 (and any
 * higher number starting with 1). '%CIP-5%' matches CIP-50, CIP-51, CIP-52.
 * Every "mentions this CIP" lookup built on those patterns over-reports.
 *
 * '0*' accepts any padding, '(?![0-9])' is the right edge LIKE cannot express.
 * The separator stays REQUIRED so 'cip' inside another word is never a match.
 */
export function cipCitationRegex(cipId: string): RegExp | null {
  const p = cipMentionPatterns(cipId);
  if (!p) return null;
  if (/^\d+$/.test(p.numericId)) {
    return new RegExp(`cip[-\\s]0*${parseInt(p.numericId, 10)}(?![0-9])`, 'i');
  }
  // Non-numeric ids have no padding to normalise and no numeric tail to run
  // past, so the anchor is just the literal with the same right edge.
  const literal = p.numericId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`cip[-\\s]${literal}(?![0-9])`, 'i');
}

/**
 * Registers `cip_cites(text, cip_id)` on a connection so the anchor can be
 * applied in SQL, where both a count and its own sample need to agree.
 *
 * Filtering rows in JS after a LIKE was the other option, and it is the one
 * that lets a count and its own sample drift apart. One predicate, used by
 * every caller.
 *
 * Regexes are cached per id: without it every row recompiles the same pattern.
 */
export function registerCipCitesFn(db: {
  function: (name: string, fn: (...args: never[]) => unknown) => unknown;
}): void {
  const cache = new Map<string, RegExp | null>();
  db.function('cip_cites', ((text: unknown, cipId: unknown): number => {
    if (typeof text !== 'string' || typeof cipId !== 'string') return 0;
    let re = cache.get(cipId);
    if (re === undefined) {
      re = cipCitationRegex(cipId);
      cache.set(cipId, re);
    }
    return re && re.test(text) ? 1 : 0;
  }) as unknown as (...args: never[]) => unknown);
}

/**
 * SQL for "this column cites the CIP bound to the next parameter".
 *
 * The LIKE is a prefilter, not the test: it is evaluated in C over every row
 * and hands cip_cites only the rows that mention a CIP at all, which is what
 * keeps a citation lookup off a full JS scan of the corpus. It is
 * deliberately looser than the anchor so it can never exclude a real match.
 */
export function cipCitesSql(column: string): string {
  return `(${column} LIKE '%cip%' AND cip_cites(${column}, ?))`;
}
