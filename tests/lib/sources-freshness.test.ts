import { describe, expect, test } from 'vitest';
import type { SourceEntry } from '@/lib/sources';
import { agoLabel, freshnessRows, latestSync, ragChunkCount } from '@/app/sources/freshness';
import { deadlineLabel } from '@/components/monitor-parts';

function entry(type: string, count: number, last_synced: string | null): SourceEntry {
  return { type, desc: '', count, last_synced };
}

const SCHEDULE = new Map([
  ['sync-docs', { bucket: 'slow' }],
  ['sync-forum', { bucket: 'daily' }],
  ['sync-github-releases', { bucket: 'medium' }],
]);

describe('freshnessRows', () => {
  test('excludes embedding chunks from the table', () => {
    const rows = freshnessRows([entry('doc', 12, null), entry('embedding_chunk', 900, null)], SCHEDULE);
    expect(rows.map((r) => r.type)).toEqual(['doc']);
  });

  test('orders rows by record count, then by name', () => {
    const rows = freshnessRows(
      [entry('doc', 10, null), entry('forum_topic', 12, null), entry('blog_post', 10, null)],
      SCHEDULE,
    );
    expect(rows.map((r) => r.type)).toEqual(['forum_topic', 'blog_post', 'doc']);
  });

  test('takes the cadence from the schedule bucket of the sync script', () => {
    const rows = freshnessRows(
      [entry('doc', 1, null), entry('forum_topic', 1, null), entry('github_release', 1, null)],
      SCHEDULE,
    );
    const byType = Object.fromEntries(rows.map((r) => [r.type, r.cadence]));
    expect(byType).toEqual({ doc: '6 h', forum_topic: '24 h', github_release: '15 min' });
  });

  test('leaves the cadence empty when the schedule does not list the script', () => {
    const rows = freshnessRows([entry('blog_post', 1, null)], SCHEDULE);
    expect(rows[0].cadence).toBeNull();
  });

  test('keeps an unknown source type visible under its raw name without a link', () => {
    const rows = freshnessRows([entry('mystery', 3, null)], SCHEDULE);
    expect(rows[0]).toMatchObject({ name: 'mystery', href: null, cadence: null, records: 3 });
  });
});

describe('latestSync', () => {
  test('returns the newest timestamp across sources', () => {
    const newest = latestSync([
      entry('forum_topic', 1, '2026-10-28T10:00:00.000Z'),
      entry('doc', 1, '2026-10-29T08:30:00.000Z'),
      entry('blog_post', 1, null),
    ]);
    expect(newest).toBe('2026-10-29T08:30:00.000Z');
  });

  test('returns null when no source has a sync time', () => {
    expect(latestSync([entry('forum_topic', 1, null)])).toBeNull();
  });
});

describe('ragChunkCount', () => {
  test('sums only the embedding chunk entries', () => {
    expect(ragChunkCount([entry('forum_topic', 5, null), entry('embedding_chunk', 900, null)])).toBe(900);
  });
});

describe('agoLabel', () => {
  const now = Date.parse('2026-10-29T12:00:00.000Z');

  test.each([
    ['2026-10-29T11:59:30.000Z', '1m ago'],
    ['2026-10-29T11:15:00.000Z', '45m ago'],
    ['2026-10-29T07:00:00.000Z', '5h ago'],
    ['2026-10-25T12:00:00.000Z', '4d ago'],
    ['2026-07-01T12:00:00.000Z', '4mo ago'],
  ])('formats %s as %s', (iso, label) => {
    expect(agoLabel(iso, now)).toBe(label);
  });

  test('reads a future or unparseable time as now', () => {
    expect(agoLabel('2026-10-30T12:00:00.000Z', now)).toBe('now');
    expect(agoLabel('not a date', now)).toBe('now');
  });
});

describe('deadlineLabel', () => {
  test('trims an ISO deadline to the minute and swaps the T for a space', () => {
    expect(deadlineLabel('2026-11-03T14:00:00Z')).toBe('2026-11-03 14:00');
  });

  test('keeps a date-only deadline whole', () => {
    expect(deadlineLabel('2026-12-01')).toBe('2026-12-01');
  });

  test('keeps a written-out deadline instead of cutting it mid-word', () => {
    expect(deadlineLabel('June 24, 2026')).toBe('June 24, 2026');
  });
});
