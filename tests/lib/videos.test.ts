import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '@/lib/db';
import { getVideos, getDistinctChannels, getChannelCounts, getRelatedVideos, getVideo, getVideosGlance, parseVideoPage, parseVideoSort, transcriptOf } from '@/lib/videos';
import { logRun } from '@/lib/sync-log';
import { encodeSegments, segmentsText } from '@/lib/video-transcript';

const NOW = new Date().toISOString();

function seedVideo(id: string, title: string, channel: string, published_at: string) {
  getDb().prepare(
    'INSERT INTO youtube_videos (id, title, description, published_at, url, thumbnail_url, channel_name, synced_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run(id, title, '', published_at, `https://youtube.com/watch?v=${id}`, '', channel, NOW);
}

describe('getVideos', () => {
  beforeEach(() => { resetDb(); });

  it('returns all videos sorted by published_at desc', () => {
    seedVideo('v1', 'Old Video', 'NEAR Network', '2026-01-01T00:00:00Z');
    seedVideo('v2', 'New Video', 'Beta Channel', '2026-06-01T00:00:00Z');
    const { videos } = getVideos({});
    expect(videos[0].id).toBe('v2');
    expect(videos[1].id).toBe('v1');
  });

  it('filters by channel_name', () => {
    seedVideo('v1', 'NEAR Video', 'NEAR Network', '2026-01-01T00:00:00Z');
    seedVideo('v2', 'Beta Video', 'Beta Channel', '2026-01-02T00:00:00Z');
    const { videos } = getVideos({ channel: 'Beta Channel' });
    expect(videos).toHaveLength(1);
    expect(videos[0].id).toBe('v2');
  });

  it('paginates correctly', () => {
    for (let i = 1; i <= 25; i++) {
      seedVideo(`v${i}`, `Video ${i}`, 'NEAR Network', `2026-01-${String(i).padStart(2,'0')}T00:00:00Z`);
    }
    const { videos, total, totalPages } = getVideos({ page: 1, perPage: 20 });
    expect(videos).toHaveLength(20);
    expect(total).toBe(25);
    expect(totalPages).toBe(2);
  });
});

describe('getDistinctChannels', () => {
  beforeEach(() => { resetDb(); });

  it('returns distinct channel names sorted alphabetically', () => {
    seedVideo('v1', 'Video 1', 'NEAR Network', '2026-01-01T00:00:00Z');
    seedVideo('v2', 'Video 2', 'Beta Channel', '2026-01-02T00:00:00Z');
    seedVideo('v3', 'Video 3', 'NEAR Network', '2026-01-03T00:00:00Z');
    const channels = getDistinctChannels();
    expect(channels).toEqual(['Beta Channel', 'NEAR Network']);
  });
});

function seedTalk(id: string, title: string, channel: string, published_at: string, lines: string[]) {
  const segs = lines.map((text, i) => ({ start: i * 10, text }));
  getDb().prepare(
    'INSERT INTO youtube_videos (id, title, description, published_at, url, thumbnail_url, channel_name, synced_at, transcript_text, transcript_segments, transcript_synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).run(id, title, 'A description. Second sentence.\n\nSecond paragraph.', published_at, `https://youtube.com/watch?v=${id}`, '', channel, NOW, segmentsText(segs), encodeSegments(segs), NOW);
}

describe('parseVideoPage', () => {
  it('turns anything that is not a positive number into the first page', () => {
    expect(parseVideoPage(undefined)).toBe(1);
    expect(parseVideoPage('abc')).toBe(1);
    expect(parseVideoPage('-4')).toBe(1);
    expect(parseVideoPage('0')).toBe(1);
    expect(parseVideoPage('3')).toBe(3);
    expect(parseVideoPage('99999999')).toBe(500);
  });
});

describe('parseVideoSort', () => {
  it('defaults to best match with a query and newest without', () => {
    expect(parseVideoSort(undefined, true)).toBe('relevance');
    expect(parseVideoSort(undefined, false)).toBe('newest');
    expect(parseVideoSort('relevance', false)).toBe('newest');
    expect(parseVideoSort('oldest', true)).toBe('oldest');
  });
});

describe('getVideos with a page that is not a number', () => {
  beforeEach(() => { resetDb(); });

  it('does not fail on NaN or negative pages', () => {
    seedVideo('v1', 'One', 'Gamma Channel', '2026-01-01T00:00:00Z');
    expect(getVideos({ page: Number.NaN }).videos).toHaveLength(1);
    expect(getVideos({ page: -3 }).videos).toHaveLength(1);
  });
});

describe('getVideos search', () => {
  beforeEach(() => { resetDb(); });

  it('finds a video by what is said in it and returns the passage with its time', () => {
    seedTalk('t1', 'Operations talk', 'NEAR Network', '2026-02-01T00:00:00Z', ['welcome', 'today we cover pruning of packages', 'and then upgrades']);
    seedTalk('t2', 'Other talk', 'Gamma Channel', '2026-03-01T00:00:00Z', ['nothing relevant', 'at all']);
    const { videos, total } = getVideos({ q: 'pruning' });
    expect(total).toBe(1);
    expect(videos[0].id).toBe('t1');
    expect(videos[0].passage?.start).toBeGreaterThanOrEqual(0);
    expect(videos[0].passage?.text).toContain('pruning');
    expect(videos[0].has_transcript).toBe(true);
  });

  it('finds a video by its title and gives no passage when the transcript does not mention the word', () => {
    seedTalk('t1', 'Atlas overview', 'NEAR Network', '2026-02-01T00:00:00Z', ['welcome', 'something else']);
    const { videos } = getVideos({ q: 'atlas' });
    expect(videos).toHaveLength(1);
    expect(videos[0].passage).toBeNull();
  });

  it('returns nothing for a query that has no searchable word', () => {
    seedTalk('t1', 'A talk', 'Gamma Channel', '2026-02-01T00:00:00Z', ['words']);
    expect(getVideos({ q: '!!!' })).toMatchObject({ videos: [], total: 0 });
  });

  it('keeps the channel filter when searching', () => {
    seedTalk('t1', 'Pruning one', 'Gamma Channel', '2026-02-01T00:00:00Z', ['pruning']);
    seedTalk('t2', 'Pruning two', 'NEAR Network', '2026-02-02T00:00:00Z', ['pruning']);
    const { videos } = getVideos({ q: 'pruning', channel: 'Gamma Channel' });
    expect(videos.map(v => v.id)).toEqual(['t1']);
  });

  it('summarises the first paragraph of the description and never ships the transcript to the list', () => {
    seedTalk('t1', 'A talk', 'Gamma Channel', '2026-02-01T00:00:00Z', ['words']);
    const [v] = getVideos({}).videos;
    expect(v.summary).toBe('A description. Second sentence.');
    expect(Object.keys(v)).not.toContain('transcript_text');
  });
});

describe('getChannelCounts', () => {
  beforeEach(() => { resetDb(); });

  it('counts every channel and narrows to a search', () => {
    seedTalk('t1', 'Pruning one', 'Gamma Channel', '2026-02-01T00:00:00Z', ['pruning']);
    seedTalk('t2', 'Pruning two', 'NEAR Network', '2026-02-02T00:00:00Z', ['pruning']);
    seedTalk('t3', 'Other', 'NEAR Network', '2026-02-03T00:00:00Z', ['nothing']);
    expect(getChannelCounts()).toEqual([{ name: 'NEAR Network', count: 2 }, { name: 'Gamma Channel', count: 1 }]);
    expect(getChannelCounts('pruning')).toEqual([{ name: 'Gamma Channel', count: 1 }, { name: 'NEAR Network', count: 1 }]);
    expect(getChannelCounts('!!!')).toEqual([]);
  });
});

describe('transcriptOf', () => {
  beforeEach(() => { resetDb(); });

  it('groups timed lines into blocks and falls back to plain text without timings', () => {
    seedTalk('t1', 'Timed', 'Gamma Channel', '2026-02-01T00:00:00Z', ['one', 'two']);
    const timed = transcriptOf(getVideo('t1')!);
    expect(timed.timed).toBe(true);
    expect(timed.blocks[0].start).toBe(0);
    const plain = transcriptOf({ transcript_text: 'just words', transcript_segments: null });
    expect(plain).toEqual({ blocks: [], timed: false, plain: 'just words' });
    expect(transcriptOf({ transcript_text: null, transcript_segments: null }).plain).toBeNull();
  });
});

describe('getRelatedVideos and getVideosGlance', () => {
  beforeEach(() => { resetDb(); });

  it('lists the newest other videos of the same channel', () => {
    seedVideo('a', 'A', 'Gamma Channel', '2026-01-01T00:00:00Z');
    seedVideo('b', 'B', 'Gamma Channel', '2026-02-01T00:00:00Z');
    seedVideo('c', 'C', 'Gamma Channel', '2026-03-01T00:00:00Z');
    seedVideo('d', 'D', 'Other', '2026-04-01T00:00:00Z');
    expect(getRelatedVideos('a', 'Gamma Channel', 2).map(v => v.id)).toEqual(['c', 'b']);
    expect(getRelatedVideos('a', null)).toEqual([]);
  });

  it('reports the newest video, how many have transcripts and when the channels were last checked', () => {
    seedVideo('a', 'A', 'Gamma Channel', '2026-01-01T00:00:00Z');
    seedTalk('b', 'B', 'Gamma Channel', '2026-05-01T00:00:00Z', ['words']);
    logRun('youtube', { status: 'success', items: 0 });
    const glance = getVideosGlance();
    expect(glance.total).toBe(2);
    expect(glance.withTranscript).toBe(1);
    expect(glance.newest?.id).toBe('b');
    expect(glance.checkedAt).not.toBeNull();
  });
});
