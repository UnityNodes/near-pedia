import { describe, it, expect } from 'vitest';
import { mergeActivityStream, type ActivityItem } from '@/lib/activity-stream';
import { SITE } from '@/lib/site.config';

const make = (kind: ActivityItem['kind'], when: string, id: string): ActivityItem => ({
  kind, when, id, title: `${kind}-${id}`, url: `${SITE.url}/${id}`,
});

describe('mergeActivityStream', () => {
  it('returns empty stream when no sources provided', () => {
    const s = mergeActivityStream(7, {}, 100);
    expect(s.total).toBe(0);
    expect(s.items).toEqual([]);
    expect(s.window_days).toBe(7);
    // every kind starts at 0
    expect(s.counts.change_event).toBe(0);
    expect(s.counts.new_blog_post).toBe(0);
  });

  it('sorts merged items descending by ISO timestamp', () => {
    const stream = mergeActivityStream(7, {
      change_event:      [make('change_event',      '2026-06-01T10:00:00Z', 'a')],
      new_blog_post:     [make('new_blog_post',     '2026-06-03T08:00:00Z', 'b')],
      new_release:       [make('new_release',       '2026-06-02T15:00:00Z', 'c')],
    }, 100);
    expect(stream.items.map(i => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('reports per-kind counts pre-limit (so consumers know what was truncated)', () => {
    const stream = mergeActivityStream(7, {
      change_event: Array.from({ length: 12 }, (_, i) => make('change_event', `2026-06-03T0${i % 10}:00:00Z`, `x${i}`)),
      new_release:       Array.from({ length: 3 }, (_, i) => make('new_release', `2026-06-02T0${i}:00:00Z`, `r${i}`)),
    }, 5);
    expect(stream.counts.change_event).toBe(12);
    expect(stream.counts.new_release).toBe(3);
    expect(stream.items.length).toBe(5);   // overall cap applied
    expect(stream.total).toBe(15);
  });

  it('takes per-kind counts and total from the totals the caller counted, not from the capped lists', () => {
    const stream = mergeActivityStream(30, {
      change_event: Array.from({ length: 3 }, (_, i) => make('change_event', `2026-06-03T0${i}:00:00Z`, `c${i}`)),
      new_release: [make('new_release', '2026-06-02T00:00:00Z', 'r0')],
    }, 2, { change_event: 520, new_release: 42 });
    expect(stream.counts.change_event).toBe(520);
    expect(stream.counts.new_release).toBe(42);
    expect(stream.total).toBe(562);
    expect(stream.items.length).toBe(2);
  });

  it('caps items at the requested limit', () => {
    const items = Array.from({ length: 50 }, (_, i) => make('new_forum_topic', `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00Z`, `t${i}`));
    const s = mergeActivityStream(30, { new_forum_topic: items }, 10);
    expect(s.items.length).toBe(10);
  });

  it('breaks ties on equal timestamps by item id (deterministic ordering)', () => {
    const stream = mergeActivityStream(1, {
      new_forum_topic: [
        make('new_forum_topic', '2026-06-03T00:00:00Z', 'beta'),
        make('new_forum_topic', '2026-06-03T00:00:00Z', 'alpha'),
      ],
    }, 10);
    // Same when → ascending id within the tie.
    expect(stream.items.map(i => i.id)).toEqual(['alpha', 'beta']);
  });

  it('window_days echoes the input', () => {
    expect(mergeActivityStream(30, {}, 1).window_days).toBe(30);
    expect(mergeActivityStream(90, {}, 1).window_days).toBe(90);
  });

  it('skips non-array source entries gracefully', () => {
    const s = mergeActivityStream(7, {
      // Simulating a per-source DB error that fell back to null.
      new_forum_topic: undefined,
      new_release: [make('new_release', '2026-06-03T00:00:00Z', 'p1')],
    }, 100);
    expect(s.items.length).toBe(1);
    expect(s.counts.new_forum_topic).toBe(0);
    expect(s.counts.new_release).toBe(1);
  });

  it('every activity kind present in the counts object', () => {
    const s = mergeActivityStream(7, {}, 1);
    expect(Object.keys(s.counts).sort()).toEqual([
      'change_event',
      'new_blog_post',
      'new_forum_topic',
      'new_radar_item',
      'new_release',
    ]);
  });
});
