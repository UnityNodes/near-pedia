import { describe, it, expect } from 'vitest';
import { normalizeCipId } from '@/lib/cip-id';

describe('normalizeCipId', () => {
  it('returns null for non-strings', () => {
    expect(normalizeCipId(null)).toBeNull();
    expect(normalizeCipId(undefined)).toBeNull();
  });

  it('returns null for empty / whitespace input', () => {
    expect(normalizeCipId('')).toBeNull();
    expect(normalizeCipId('   ')).toBeNull();
  });

  it('pads a bare number to 4 digits', () => {
    expect(normalizeCipId('1')).toBe('0001');
    expect(normalizeCipId('42')).toBe('0042');
    expect(normalizeCipId('100')).toBe('0100');
    expect(normalizeCipId('0001')).toBe('0001');
  });

  it('strips CIP- prefix and pads (case-insensitive)', () => {
    expect(normalizeCipId('CIP-42')).toBe('0042');
    expect(normalizeCipId('cip-0042')).toBe('0042');
    expect(normalizeCipId('Cip-1')).toBe('0001');
  });

  it('uppercases PR- prefix and leaves it intact', () => {
    expect(normalizeCipId('PR-117')).toBe('PR-117');
    expect(normalizeCipId('pr-117')).toBe('PR-117');
    expect(normalizeCipId('Pr-9')).toBe('PR-9');
  });

  it('trims surrounding whitespace before normalizing', () => {
    expect(normalizeCipId('  42  ')).toBe('0042');
    expect(normalizeCipId('\tCIP-7\n')).toBe('0007');
  });

  it('returns null for non-numeric after stripping CIP-', () => {
    expect(normalizeCipId('CIP-abc')).toBeNull();
    expect(normalizeCipId('hello')).toBeNull();
    expect(normalizeCipId('42abc')).toBeNull();
  });

  it('returns null when numeric part exceeds 4 digits', () => {
    // The storage column is fixed-width; silently truncating or padding
    // a 5-digit input to '99999' would point at a non-existent row.
    expect(normalizeCipId('99999')).toBeNull();
    expect(normalizeCipId('CIP-12345')).toBeNull();
  });

  it('PR- without a digit suffix is rejected', () => {
    expect(normalizeCipId('PR-')).toBeNull();
    expect(normalizeCipId('PR-abc')).toBeNull();
  });

  it('does not lowercase PR- bodies (defensive)', () => {
    // PR- ids in storage are uppercase. Mixed-case input gets folded
    // up so the lookup never silently misses.
    expect(normalizeCipId('Pr-117')).toBe('PR-117');
  });
});
