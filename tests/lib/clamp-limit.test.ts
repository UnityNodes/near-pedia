import { describe, it, expect } from 'vitest';
import { clampLimit } from '@/lib/clamp-limit';

describe('clampLimit', () => {
  it('passes through a valid in-range value', () => {
    expect(clampLimit('20', 20, 100)).toBe(20);
    expect(clampLimit(20, 20, 100)).toBe(20);
  });

  it('floors a negative value to 1, not to the default or through to SQLite as unlimited', () => {
    expect(clampLimit('-1', 20, 100)).toBe(1);
    expect(clampLimit(-1, 20, 100)).toBe(1);
    expect(clampLimit('-9999', 20, 100)).toBe(1);
  });

  it('falls back to the default for 0, missing, or non-numeric input', () => {
    expect(clampLimit('0', 20, 100)).toBe(20);
    expect(clampLimit(undefined, 20, 100)).toBe(20);
    expect(clampLimit('abc', 20, 100)).toBe(20);
    expect(clampLimit('', 20, 100)).toBe(20);
  });

  it('caps a value above the ceiling', () => {
    expect(clampLimit('99999', 20, 100)).toBe(100);
  });

  it('handles a default that is itself out of [1,max] defensively', () => {
    expect(clampLimit('abc', 0, 100)).toBe(1);
  });
});
