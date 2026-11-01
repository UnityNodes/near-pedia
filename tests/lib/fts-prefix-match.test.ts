import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '@/lib/db';
import { ftsPrefixMatch } from '@/lib/rank';
import { getCips } from '@/lib/cips';
import { getTopics } from '@/lib/forum';
import { getDocs } from '@/lib/docs';

describe('ftsPrefixMatch', () => {
  it('turns words into ANDed prefix terms', () => {
    expect(ftsPrefixMatch('Network coin')).toBe('network* coin*');
  });

  it('splits CIP-0042 the way the index does', () => {
    expect(ftsPrefixMatch('CIP-0042')).toBe('cip* 0042*');
  });

  it.each(['"', 'a AND', 'NEAR(', '(', 'hello OR', 'body:secret', '"a" OR "b"', '"x NEAR( y"', '" AND "'])('leaves no FTS5 syntax in %s', q => {
    const m = ftsPrefixMatch(q);
    if (m !== null) expect(m).toMatch(/^("[\p{L}\p{N} ]+"|[\p{L}\p{N}* ]+)$/u);
  });

  it('reads a query wrapped in quotes as a phrase of whole words', () => {
    expect(ftsPrefixMatch('"Local Party"')).toBe('"local party"');
    expect(ftsPrefixMatch(' "DAR" ')).toBe('"dar"');
    expect(ftsPrefixMatch('"x NEAR( y"')).toBe('"x near y"');
  });

  it('is null when nothing searchable is left', () => {
    expect(ftsPrefixMatch('"" ()')).toBeNull();
    expect(ftsPrefixMatch('')).toBeNull();
  });
});

describe('list pages with hostile queries', () => {
  beforeEach(() => {
    resetDb();
    getDb().prepare('INSERT INTO cips (id, title, content_md, synced_at) VALUES (?, ?, ?, ?)')
      .run('0042', 'Network coin minting', 'body text', '2026-10-14T00:00:00Z');
  });

  it.each(['"', 'a AND', 'NEAR(', '(', 'hello OR', '""'])('does not throw on %s', q => {
    expect(() => getCips({ q })).not.toThrow();
    expect(() => getTopics({ q })).not.toThrow();
    expect(() => getDocs({ q })).not.toThrow();
  });
});
