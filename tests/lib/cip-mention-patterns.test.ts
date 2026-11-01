import { describe, it, expect } from 'vitest';
import { cipMentionPatterns, cipMentionLikeStrings } from '@/lib/cip-mention-patterns';

describe('cipMentionPatterns', () => {
  it('returns null for non-string', () => {
    expect(cipMentionPatterns(null as unknown as string)).toBeNull();
    expect(cipMentionPatterns(undefined as unknown as string)).toBeNull();
  });

  it('returns null for empty / whitespace', () => {
    expect(cipMentionPatterns('')).toBeNull();
    expect(cipMentionPatterns('   ')).toBeNull();
  });

  it('handles bare numeric id', () => {
    expect(cipMentionPatterns('42')).toEqual({
      padded: 'CIP-0042',
      unpadded: 'CIP-42',
      numericId: '0042',
    });
  });

  it('handles already-padded numeric id', () => {
    expect(cipMentionPatterns('0042')).toEqual({
      padded: 'CIP-0042',
      unpadded: 'CIP-42',
      numericId: '0042',
    });
  });

  it('strips CIP- prefix case-insensitively', () => {
    expect(cipMentionPatterns('CIP-42')).toEqual({
      padded: 'CIP-0042',
      unpadded: 'CIP-42',
      numericId: '0042',
    });
    expect(cipMentionPatterns('cip-7')).toEqual({
      padded: 'CIP-0007',
      unpadded: 'CIP-7',
      numericId: '0007',
    });
  });

  it('PR- form keeps prefix and has null unpadded', () => {
    // PR-117 isn't a numeric CIP — only the padded/numericId form
    // is usable for LIKE patterns; the unpadded slot is null.
    expect(cipMentionPatterns('PR-117')).toEqual({
      padded: 'CIP-PR-117',
      unpadded: null,
      numericId: 'PR-117',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(cipMentionPatterns('  CIP-42  ')?.padded).toBe('CIP-0042');
  });

  it('large numeric id keeps padded as-is (no truncation)', () => {
    // Mention-pattern helper, unlike normalizeCipId, is permissive
    // here — we don't want to silently drop a search for CIP-12345.
    const r = cipMentionPatterns('12345');
    expect(r?.numericId).toBe('12345');
    expect(r?.padded).toBe('CIP-12345');
    expect(r?.unpadded).toBe('CIP-12345');
  });

  it('zero-leading number unpadded form is parsed as integer', () => {
    // CIP-0007 → unpadded should be 'CIP-7', not 'CIP-07'.
    expect(cipMentionPatterns('0007')?.unpadded).toBe('CIP-7');
    expect(cipMentionPatterns('0100')?.unpadded).toBe('CIP-100');
  });
});

describe('cipMentionLikeStrings', () => {
  it('wraps padded form with % and matches unpadded when distinct', () => {
    expect(cipMentionLikeStrings('42')).toEqual({
      padded: '%CIP-0042%',
      unpadded: '%CIP-42%',
    });
  });

  it('falls back to padded when unpadded equals padded (no leading zeros)', () => {
    // CIP-12345: numeric padding has no effect, so the two LIKE
    // patterns end up identical. Caller can still pass both into
    // the OR'd query without changing query semantics.
    expect(cipMentionLikeStrings('12345')).toEqual({
      padded: '%CIP-12345%',
      unpadded: '%CIP-12345%',
    });
  });

  it('PR- form falls back to padded for both slots', () => {
    expect(cipMentionLikeStrings('PR-117')).toEqual({
      padded: '%CIP-PR-117%',
      unpadded: '%CIP-PR-117%',
    });
  });

  it('returns null for invalid input', () => {
    expect(cipMentionLikeStrings('')).toBeNull();
  });
});
