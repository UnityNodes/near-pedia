import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '@/lib/db';
import { ftsPrefixMatch } from '@/lib/rank';
import { getTopics } from '@/lib/forum';
import { getDocs } from '@/lib/docs';

describe('ftsPrefixMatch', () => {
  it('turns words into ANDed prefix terms', () => {
    expect(ftsPrefixMatch('Network coin')).toBe('network* coin*');
  });

  it('splits NEP-0141 the way the index does', () => {
    expect(ftsPrefixMatch('NEP-0141')).toBe('nep* 0141*');
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
    getDb().prepare('INSERT INTO doc_pages (url, title, content_text, source, synced_at) VALUES (?, ?, ?, ?, ?)')
      .run('https://docs.example.com/minting', 'Network coin minting', 'body text', 'docs', '2026-10-14T00:00:00Z');
  });

  it.each(['"', 'a AND', 'NEAR(', '(', 'hello OR', '""'])('does not throw on %s', q => {
    expect(() => getTopics({ q })).not.toThrow();
    expect(() => getDocs({ q })).not.toThrow();
  });
});
