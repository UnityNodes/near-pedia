// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { safeTokenEqual } from '@/lib/safe-token';

/**
 * Moved here with the function when the admin surface was deleted. /api/metrics
 * is the caller that depends on it now.
 */
describe('safeTokenEqual', () => {
  it('returns true for identical tokens', () => {
    expect(safeTokenEqual('s3cret-token', 's3cret-token')).toBe(true);
  });
  it('returns false for differing tokens of equal length', () => {
    expect(safeTokenEqual('aaaaaaaa', 'aaaaaaab')).toBe(false);
  });
  it('returns false for length mismatch (no throw)', () => {
    expect(safeTokenEqual('short', 'a-much-longer-token')).toBe(false);
  });
  it('returns false when either side is null/undefined/empty', () => {
    expect(safeTokenEqual(null, 'x')).toBe(false);
    expect(safeTokenEqual('x', undefined)).toBe(false);
    expect(safeTokenEqual('', '')).toBe(false);
  });
});

