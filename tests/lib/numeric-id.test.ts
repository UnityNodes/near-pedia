import { describe, expect, it } from 'vitest';
import { numericId } from '../../lib/numeric-id';

describe('numericId', () => {
  it('keeps a whole number as it is', () => {
    expect(numericId.parse(5)).toBe(5);
    expect(numericId.parse(0)).toBe(0);
  });

  it('reads a string of digits, which is what generic MCP clients send for an id', () => {
    expect(numericId.parse('5')).toBe(5);
    expect(numericId.parse(' 42 ')).toBe(42);
    expect(numericId.parse('007')).toBe(7);
    expect(numericId.parse('123456789012345')).toBe(123456789012345);
  });

  it('still refuses anything that is not a whole number', () => {
    for (const bad of ['', ' ', 'abc', '5.5', '-1', '1e3', '0x10', '12abc', '9999999999999999', 5.5, null, undefined, {}, [], true]) {
      expect(numericId.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
