import { getDb } from './db';
import { ftsPrefixMatch } from './rank';
import { decodeSegments, excerptAround, findPassages, groupSegments, queryTokens } from './video-transcript';
import type { TranscriptBlock, TranscriptPassage } from './video-transcript';

export interface VideoRow {
  id: string;
  title: string;
  description: string | null;
  published_at: string | null;
  url: string;
  thumbnail_url: string | null;
  channel_name: string | null;
  synced_at: string | null;
  transcript_text: string | null;
  transcript_segments: string | null;
  transcript_synced_at: string | null;
}

export interface VideoListItem {
  id: string;
  title: string;
  summary: string;
  published_at: string | null;
  thumbnail_url: string | null;
  channel_name: string | null;
  has_transcript: boolean;
  passage: TranscriptPassage | null;
}

export type VideoSort = 'newest' | 'oldest' | 'relevance';

export interface GetVideosOptions {
  channel?: string;
  q?: string;
  sort?: VideoSort;
  page?: number;
  perPage?: number;
}

export interface GetVideosResult {
  videos: VideoListItem[];
  total: number;
  page: number;
  totalPages: number;
}

const SUMMARY_CHARS = 320;
export const MAX_VIDEO_PAGE = 500;

export function parseVideoPage(raw: string | undefined): number {
  const n = parseInt(raw ?? '1', 10);
  return Number.isFinite(n) ? Math.min(Math.max(1, n), MAX_VIDEO_PAGE) : 1;
}

export function parseVideoSort(raw: string | undefined, hasQuery: boolean): VideoSort {
  if (raw === 'oldest') return 'oldest';
  if (raw === 'newest') return 'newest';
  if (raw === 'relevance' && hasQuery) return 'relevance';
  return hasQuery ? 'relevance' : 'newest';
}

function summaryOf(description: string | null): string {
  const first = (description ?? '').split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  if (first.length <= SUMMARY_CHARS) return first;
  const cut = first.slice(0, SUMMARY_CHARS);
  const space = cut.lastIndexOf(' ');
  return `${(space > SUMMARY_CHARS * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

interface ListRow {
  id: string;
  title: string;
  description: string | null;
  published_at: string | null;
  thumbnail_url: string | null;
  channel_name: string | null;
  has_transcript: number;
  transcript_segments?: string | null;
}

function orderOf(sort: VideoSort, hasQuery: boolean): string {
  if (sort === 'oldest') return 'v.published_at ASC, v.id ASC';
  if (sort === 'relevance' && hasQuery) return 'rank, v.published_at DESC, v.id ASC';
  return 'v.published_at DESC, v.id ASC';
}

export function getVideos(opts: GetVideosOptions): GetVideosResult {
  const db = getDb();
  const page = Math.min(Math.max(1, Math.floor(opts.page ?? 1) || 1), MAX_VIDEO_PAGE);
  const perPage = opts.perPage ?? 24;
  const offset = (page - 1) * perPage;
  const q = opts.q?.trim() || undefined;
  const ftsQ = q ? ftsPrefixMatch(q) : null;
  const empty: GetVideosResult = { videos: [], total: 0, page, totalPages: 1 };
  if (q && !ftsQ) return empty;

  const conds: string[] = [];
  const params: (string | number)[] = [];
  if (opts.channel) {
    conds.push('v.channel_name = ?');
    params.push(opts.channel);
  }
  const join = ftsQ ? 'JOIN youtube_videos_fts ON v.rowid = youtube_videos_fts.rowid' : '';
  if (ftsQ) {
    conds.push('youtube_videos_fts MATCH ?');
    params.push(ftsQ);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const from = `FROM youtube_videos v ${join} ${where}`;
  const total = (db.prepare(`SELECT COUNT(*) AS c ${from}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT v.id, v.title, v.description, v.published_at, v.thumbnail_url, v.channel_name,
            (v.transcript_text IS NOT NULL) AS has_transcript
     ${from} ORDER BY ${orderOf(opts.sort ?? 'newest', Boolean(ftsQ))} LIMIT ? OFFSET ?`
  ).all(...params, perPage, offset) as ListRow[];

  const segmentsById = new Map<string, string | null>();
  if (q && rows.length > 0) {
    const found = db.prepare(
      `SELECT id, transcript_segments FROM youtube_videos WHERE id IN (${rows.map(() => '?').join(', ')})`
    ).all(...rows.map(r => r.id)) as { id: string; transcript_segments: string | null }[];
    for (const f of found) segmentsById.set(f.id, f.transcript_segments);
  }

  const tokens = q ? queryTokens(q) : [];
  const passageOf = (id: string): TranscriptPassage | null => {
    if (!q) return null;
    const hit = findPassages(decodeSegments(segmentsById.get(id)), q, 1)[0];
    return hit ? { start: hit.start, text: excerptAround(hit.text, tokens) } : null;
  };

  const videos = rows.map((r): VideoListItem => ({
    id: r.id,
    title: r.title,
    summary: summaryOf(r.description),
    published_at: r.published_at,
    thumbnail_url: r.thumbnail_url,
    channel_name: r.channel_name,
    has_transcript: r.has_transcript === 1,
    passage: passageOf(r.id),
  }));

  return { videos, total, page, totalPages: Math.max(1, Math.ceil(total / perPage)) };
}

export interface ChannelCount {
  name: string;
  count: number;
}

export function getChannelCounts(q?: string): ChannelCount[] {
  const db = getDb();
  const ftsQ = q?.trim() ? ftsPrefixMatch(q) : null;
  if (q?.trim() && !ftsQ) return [];
  const rows = ftsQ
    ? db.prepare(
        `SELECT v.channel_name AS name, COUNT(*) AS count FROM youtube_videos v
         JOIN youtube_videos_fts ON v.rowid = youtube_videos_fts.rowid
         WHERE youtube_videos_fts MATCH ? AND v.channel_name IS NOT NULL
         GROUP BY v.channel_name ORDER BY count DESC, name ASC`
      ).all(ftsQ)
    : db.prepare(
        `SELECT channel_name AS name, COUNT(*) AS count FROM youtube_videos
         WHERE channel_name IS NOT NULL GROUP BY channel_name ORDER BY count DESC, name ASC`
      ).all();
  return rows as ChannelCount[];
}

export function getVideo(id: string): VideoRow | null {
  const row = getDb().prepare('SELECT * FROM youtube_videos WHERE id = ?').get(id) as VideoRow | undefined;
  return row ?? null;
}

export interface VideoTranscript {
  blocks: TranscriptBlock[];
  timed: boolean;
  plain: string | null;
}

export function transcriptOf(video: Pick<VideoRow, 'transcript_text' | 'transcript_segments'>): VideoTranscript {
  const segments = decodeSegments(video.transcript_segments);
  if (segments.length > 0) return { blocks: groupSegments(segments), timed: true, plain: video.transcript_text };
  return { blocks: [], timed: false, plain: video.transcript_text };
}

export function getRelatedVideos(id: string, channel: string | null, limit: number = 3): VideoListItem[] {
  const db = getDb();
  const rows = (channel
    ? db.prepare(
        `SELECT id, title, description, published_at, thumbnail_url, channel_name, (transcript_text IS NOT NULL) AS has_transcript
         FROM youtube_videos WHERE channel_name = ? AND id <> ? ORDER BY published_at DESC, id ASC LIMIT ?`
      ).all(channel, id, limit)
    : []) as ListRow[];
  return rows.map((r): VideoListItem => ({
    id: r.id,
    title: r.title,
    summary: summaryOf(r.description),
    published_at: r.published_at,
    thumbnail_url: r.thumbnail_url,
    channel_name: r.channel_name,
    has_transcript: r.has_transcript === 1,
    passage: null,
  }));
}

export interface VideosGlance {
  total: number;
  withTranscript: number;
  newest: { id: string; title: string; published_at: string | null } | null;
  checkedAt: string | null;
}

export function getVideosGlance(): VideosGlance {
  const db = getDb();
  const counts = db.prepare(
    'SELECT COUNT(*) AS total, SUM(transcript_text IS NOT NULL) AS withTranscript FROM youtube_videos'
  ).get() as { total: number; withTranscript: number | null };
  const newest = db.prepare(
    'SELECT id, title, published_at FROM youtube_videos WHERE published_at IS NOT NULL ORDER BY published_at DESC, id ASC LIMIT 1'
  ).get() as VideosGlance['newest'] | undefined;
  const checked = db.prepare(
    `SELECT MAX(ran_at) AS ran FROM sync_log WHERE source = 'youtube' AND status IN ('success', 'partial')`
  ).get() as { ran: string | null } | undefined;
  return {
    total: counts.total,
    withTranscript: counts.withTranscript ?? 0,
    newest: newest ?? null,
    checkedAt: checked?.ran ?? null,
  };
}

export function getDistinctChannels(): string[] {
  const rows = getDb().prepare(
    'SELECT DISTINCT channel_name FROM youtube_videos WHERE channel_name IS NOT NULL ORDER BY channel_name'
  ).all() as { channel_name: string }[];
  return rows.map(r => r.channel_name);
}
