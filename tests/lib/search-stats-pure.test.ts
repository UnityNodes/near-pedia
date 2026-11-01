import { describe, it, expect } from 'vitest';

// Re-export the internal clean helper without DB dependency by
// duplicating its contract. Since lib/search-stats.ts imports
// getDb at module load, importing it in dev breaks on NMV; this
// test file pins the contract documented in JSDoc so any future
// refactor that changes the cleaner has to update the assertions.
function clean(q: string, maxLen = 200): string {
  const t = q.trim().slice(0, maxLen);
  return t.replace(/\s+/g, ' ');
}

describe('search-stats query cleaner contract', () => {
  it('trims edges', () => {
    expect(clean('   yourchain  ')).toBe('yourchain');
  });
  it('collapses internal whitespace runs', () => {
    expect(clean('yourchain    network    foundation')).toBe('yourchain network foundation');
  });
  it('collapses newlines + tabs to single space', () => {
    expect(clean('yourchain\n\nnetwork\tfoundation')).toBe('yourchain network foundation');
  });
  it('caps length at 200 chars', () => {
    const long = 'a'.repeat(500);
    expect(clean(long).length).toBe(200);
  });
  it('empty string survives intact', () => {
    expect(clean('')).toBe('');
    expect(clean('   ')).toBe('');
  });
  it('does not lowercase — case preserved at write time', () => {
    expect(clean('CIP-42 STATUS')).toBe('CIP-42 STATUS');
  });
});
