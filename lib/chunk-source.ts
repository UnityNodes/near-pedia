/**
 * What a semantic-search chunk came from: its title, link and a short label,
 * and whether its text is someone else's words. semantic_search and /ask both
 * cite chunks, so both read them through here rather than two copies of the
 * per-table lookups.
 *
 * Community-authored source types are always untrusted, radar_item among
 * them because refresh-radar copies its text from issues and releases; a
 * doc_page chunk is untrusted when its page is not first-party
 * (lib/doc-trust.ts). ecosystem_project chunks are keyed by slug. The vector
 * index keeps expired radar alerts: they come back labelled, not hidden.
 */

import type Database from 'better-sqlite3';
import { KIND_SQL, servesFullText } from './blog';
import { isFirstPartyDoc } from './doc-trust';
import type { Chunk } from './vector-store';

export const COMMUNITY_SEMANTIC_TYPES = new Set([
  'forum_topic', 'github_item', 'blog_post', 'github_release', 'github_discussion', 'ecosystem_project', 'youtube_video', 'radar_item',
]);

export interface ChunkSource {
  title: string;
  url: string;
  meta: string;
  as_of: string | null;
  untrusted: boolean;
  /** A third-party blog post is served as an excerpt, never in full. */
  excerptOnly: boolean;
}

type Row = { title: string; url: string | null; meta?: string; as_of?: string | null; excerptOnly?: boolean };

function lookup(db: Database.Database, c: Chunk, now: Date): Row | null {
  switch (c.sourceType) {
    case 'doc_page': {
      const r = db.prepare('SELECT title, url, synced_at FROM doc_pages WHERE id=?').get(c.sourceId) as { title: string; url: string; synced_at: string | null } | undefined;
      return r ? { title: r.title, url: r.url, meta: `docs · full text: get_doc(${c.sourceId})`, as_of: r.synced_at } : null;
    }
    case 'forum_topic': {
      const r = db.prepare('SELECT title, url, last_post_at FROM forum_topics WHERE id=?').get(c.sourceId) as { title: string; url: string; last_post_at: string | null } | undefined;
      return r ? { title: r.title, url: r.url, meta: 'forum', as_of: r.last_post_at } : null;
    }
    case 'youtube_video': {
      const r = db.prepare('SELECT title, channel_name, published_at FROM youtube_videos WHERE id=?').get(c.sourceId) as { title: string; channel_name: string | null; published_at: string | null } | undefined;
      return r ? {
        title: r.title,
        url: `https://youtube.com/watch?v=${c.sourceId}`,
        meta: [r.channel_name, r.published_at?.slice(0, 10)].filter(Boolean).join(' · '),
        as_of: r.published_at,
      } : null;
    }
    case 'github_item': {
      const r = db.prepare('SELECT title, url, repo, type, created_at FROM github_items WHERE id=?').get(c.sourceId) as { title: string; url: string; repo: string; type: string; created_at: string | null } | undefined;
      return r ? { title: r.title, url: r.url, meta: `${r.repo} ${r.type}`, as_of: r.created_at } : null;
    }
    case 'blog_post': {
      const r = db.prepare(`SELECT title, url, published_at, ${KIND_SQL} AS kind FROM blog_posts WHERE id=?`).get(c.sourceId) as { title: string; url: string; published_at: string | null; kind: string } | undefined;
      return r ? { title: r.title, url: r.url, meta: 'blog', as_of: r.published_at, excerptOnly: !servesFullText(r.kind) } : null;
    }
    case 'github_release': {
      const r = db.prepare('SELECT name, tag, repo, published_at FROM github_releases WHERE id=?').get(c.sourceId) as { name: string; tag: string; repo: string; published_at: string | null } | undefined;
      return r ? { title: `${r.repo} ${r.name || r.tag}`, url: `https://github.com/${r.repo}/releases/tag/${r.tag}`, meta: 'release', as_of: r.published_at } : null;
    }
    case 'github_discussion': {
      const r = db.prepare('SELECT title, url FROM github_discussions WHERE id=?').get(c.sourceId) as { title: string; url: string } | undefined;
      return r ? { title: r.title, url: r.url, meta: 'gh-discussion' } : null;
    }
    case 'ecosystem_project': {
      const r = db.prepare('SELECT title, url, synced_at FROM ecosystem_projects WHERE slug=?').get(c.sourceId) as { title: string; url: string; synced_at: string | null } | undefined;
      return r ? { title: r.title, url: r.url, meta: 'ecosystem', as_of: r.synced_at } : null;
    }
    case 'radar_item': {
      const r = db.prepare('SELECT title, source_url, expires_at, published_at FROM radar_items WHERE id=?').get(c.sourceId) as { title: string; source_url: string | null; expires_at: string | null; published_at: string | null } | undefined;
      if (!r) return null;
      const expired = r.expires_at != null && r.expires_at < now.toISOString();
      return { title: r.title, url: r.source_url, meta: expired ? `radar · EXPIRED ${r.expires_at!.slice(0, 10)}, no longer actionable` : 'radar', as_of: r.published_at };
    }
    default:
      return null;
  }
}

export function chunkSource(db: Database.Database, c: Chunk, now: Date = new Date()): ChunkSource {
  let row: Row | null = null;
  try {
    row = lookup(db, c, now);
  } catch { /* table missing for this source type: id only */ }
  const url = row?.url ?? '';
  return {
    title: row?.title ?? '',
    url,
    meta: row?.meta ?? '',
    as_of: row?.as_of ?? null,
    untrusted: COMMUNITY_SEMANTIC_TYPES.has(c.sourceType) || (c.sourceType === 'doc_page' && !isFirstPartyDoc(url)),
    excerptOnly: row?.excerptOnly ?? false,
  };
}
