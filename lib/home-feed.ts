import { getDb } from './db';

const NEW_WINDOW_MS = 3_600_000;

export interface FeedRow {
  kind: string;
  title: string;
  href: string;
  at: string;
  fresh: boolean;
  agoLabel: string;
}

export interface ReleaseRow {
  id: string;
  name: string;
  repo: string;
  at: string;
  prerelease: boolean;
  agoLabel: string;
}

export function getRecentFeed(limit = 6): FeedRow[] {
  try {
    const rows = getDb().prepare(`
      SELECT * FROM (
        SELECT 'CIP' AS kind, title, '/cips/' || id AS href, COALESCE(created_date, synced_at) AS at FROM cips
        UNION ALL
        SELECT 'FORUM', title, '/discussions/' || id, last_post_at FROM forum_topics
        UNION ALL
        SELECT 'BLOG', title, '/blog/' || id, published_at FROM blog_posts
          WHERE tags IS NULL OR tags NOT LIKE '%release-notes%'
        UNION ALL
        SELECT 'RELEASE', COALESCE(name, tag), '/releases/' || id, published_at FROM github_releases
        UNION ALL
        SELECT 'VIDEO', title, '/videos/' || id, published_at FROM youtube_videos
      )
      WHERE at IS NOT NULL
      ORDER BY at DESC
      LIMIT ?
    `).all(limit) as Omit<FeedRow, 'fresh' | 'agoLabel'>[];
    const now = Date.now();
    return rows.map((r) => ({
      ...r,
      fresh: now - new Date(r.at).getTime() < NEW_WINDOW_MS,
      agoLabel: ago(r.at, now),
    }));
  } catch {
    return [];
  }
}

export function getLatestReleases(limit = 3): { rows: ReleaseRow[]; total: number } {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, COALESCE(name, tag) AS name, repo, published_at AS at, COALESCE(prerelease, 0) AS prerelease
      FROM github_releases
      WHERE published_at IS NOT NULL
      ORDER BY published_at DESC
      LIMIT ?
    `).all(limit) as (Omit<ReleaseRow, 'prerelease' | 'agoLabel'> & { prerelease: number })[];
    const total = (db.prepare('SELECT COUNT(*) AS c FROM github_releases').get() as { c: number }).c;
    const now = Date.now();
    return {
      rows: rows.map((r) => ({ ...r, prerelease: r.prerelease === 1, agoLabel: ago(r.at, now) })),
      total,
    };
  } catch {
    return { rows: [], total: 0 };
  }
}

export function ago(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
