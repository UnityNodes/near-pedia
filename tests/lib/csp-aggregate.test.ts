import { describe, it, expect } from 'vitest';
import { aggregateCspGroups } from '@/lib/csp-aggregate';

describe('aggregateCspGroups', () => {
  it('returns empty array for empty input', () => {
    expect(aggregateCspGroups([])).toEqual([]);
  });

  it('groups by violated_directive and counts rows', () => {
    const rows = [
      { timestamp: 100, violated_directive: 'script-src', blocked_uri: 'https://evil.example/a.js' },
      { timestamp: 200, violated_directive: 'script-src', blocked_uri: 'https://evil.example/a.js' },
      { timestamp: 300, violated_directive: 'style-src',  blocked_uri: 'inline' },
    ];
    const groups = aggregateCspGroups(rows);
    expect(groups).toHaveLength(2);
    const script = groups.find(g => g.directive === 'script-src');
    expect(script?.count).toBe(2);
    expect(script?.top_blocked_uris[0]).toEqual({ uri: 'https://evil.example/a.js', n: 2 });
  });

  it('sorts directives by descending count, then alphabetically', () => {
    const rows = [
      { timestamp: 1, violated_directive: 'style-src',  blocked_uri: 'a' },
      { timestamp: 2, violated_directive: 'style-src',  blocked_uri: 'a' },
      { timestamp: 3, violated_directive: 'script-src', blocked_uri: 'b' },
      { timestamp: 4, violated_directive: 'script-src', blocked_uri: 'b' },
      { timestamp: 5, violated_directive: 'img-src',    blocked_uri: 'c' },
    ];
    const groups = aggregateCspGroups(rows);
    expect(groups.map(g => g.directive)).toEqual(['script-src', 'style-src', 'img-src']);
  });

  it('tracks last_seen as the maximum timestamp per group', () => {
    const rows = [
      { timestamp: 100, violated_directive: 'script-src', blocked_uri: 'x' },
      { timestamp: 500, violated_directive: 'script-src', blocked_uri: 'x' },
      { timestamp: 300, violated_directive: 'script-src', blocked_uri: 'x' },
    ];
    expect(aggregateCspGroups(rows)[0].last_seen).toBe(500);
  });

  it('caps top_blocked_uris at the requested limit', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      timestamp: i,
      violated_directive: 'script-src',
      blocked_uri: `https://host${i}.example/a.js`,
    }));
    const groups = aggregateCspGroups(rows, 3);
    expect(groups[0].top_blocked_uris).toHaveLength(3);
  });

  it('top_blocked_uris are sorted by count desc', () => {
    const rows = [
      { timestamp: 1, violated_directive: 'script-src', blocked_uri: 'rare' },
      ...Array.from({ length: 5 }, (_, i) => ({
        timestamp: i + 10, violated_directive: 'script-src', blocked_uri: 'common',
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        timestamp: i + 20, violated_directive: 'script-src', blocked_uri: 'mid',
      })),
    ];
    const top = aggregateCspGroups(rows)[0].top_blocked_uris;
    expect(top.map(u => u.uri)).toEqual(['common', 'mid', 'rare']);
    expect(top.map(u => u.n)).toEqual([5, 3, 1]);
  });

  it('normalizes null/empty directive to "unknown" and null/empty blocked_uri to "inline"', () => {
    const rows = [
      { timestamp: 1, violated_directive: null, blocked_uri: null },
      { timestamp: 2, violated_directive: '',   blocked_uri: '' },
      { timestamp: 3, violated_directive: '   ', blocked_uri: '   ' },
    ];
    const groups = aggregateCspGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].directive).toBe('unknown');
    expect(groups[0].top_blocked_uris[0].uri).toBe('inline');
    expect(groups[0].count).toBe(3);
  });

  it('handles null timestamps gracefully (last_seen stays null if all null)', () => {
    const rows = [
      { timestamp: null, violated_directive: 'script-src', blocked_uri: 'x' },
      { timestamp: null, violated_directive: 'script-src', blocked_uri: 'x' },
    ];
    const groups = aggregateCspGroups(rows);
    expect(groups[0].last_seen).toBeNull();
    expect(groups[0].count).toBe(2);
  });

  it('uses default limit of 5 top URIs per directive when no limit passed', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      timestamp: i,
      violated_directive: 'script-src',
      blocked_uri: `uri-${i}`,
    }));
    expect(aggregateCspGroups(rows)[0].top_blocked_uris).toHaveLength(5);
  });
});
