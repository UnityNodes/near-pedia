/**
 * Track NEARpedia content growth metrics.
 *
 * A content-count proxy for ecosystem activity (forum, GitHub, docs, videos,
 * blog, radar) - separate from the live NEAR on-chain/NEAR-market stats served
 * by get_network_state (Explorer + CoinGecko). Updated every 6 hours via the
 * slow bucket.
 */

import { getDb } from '../lib/db';
import { guardSync } from '../lib/sync-log';
import { isoNowSql } from '../lib/formats';

interface Snapshot {
  snapshot_at: string;
  forum_topics: number;
  forum_posts: number;
  github_items_open: number;
  github_items_closed: number;
  docs: number;
  videos: number;
  blog_posts: number;
  radar_critical: number;
  radar_important: number;
}

const CURRENT_COLUMNS = new Set([
  'id', 'snapshot_at', 'forum_topics', 'forum_posts', 'github_items_open', 'github_items_closed',
  'docs', 'videos', 'blog_posts', 'radar_critical', 'radar_important',
]);

async function main() {
  const db = getDb();

  // Create table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS network_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_at TEXT NOT NULL,
      forum_topics INTEGER NOT NULL,
      forum_posts INTEGER NOT NULL,
      github_items_open INTEGER,
      github_items_closed INTEGER,
      docs INTEGER NOT NULL,
      videos INTEGER NOT NULL,
      blog_posts INTEGER NOT NULL,
      radar_critical INTEGER NOT NULL,
      radar_important INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_network_stats_at ON network_stats(snapshot_at DESC);
  `);

  // Existing DBs carry columns from the template this engine came from,
  // declared NOT NULL, so simply dropping them from the INSERT would fail the
  // constraint. Any column outside the current set triggers one rebuild that
  // keeps the history of the columns still counted.
  const cols = db.prepare('PRAGMA table_info(network_stats)').all() as Array<{ name: string }>;
  if (cols.some((c) => !CURRENT_COLUMNS.has(c.name))) {
    db.exec(`
      BEGIN;
      CREATE TABLE network_stats_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_at TEXT NOT NULL,
        forum_topics INTEGER NOT NULL, forum_posts INTEGER NOT NULL,
        github_items_open INTEGER, github_items_closed INTEGER,
        docs INTEGER NOT NULL, videos INTEGER NOT NULL, blog_posts INTEGER NOT NULL,
        radar_critical INTEGER NOT NULL, radar_important INTEGER NOT NULL
      );
      INSERT INTO network_stats_new
        SELECT id, snapshot_at,
               forum_topics, forum_posts, github_items_open, github_items_closed,
               docs, videos, blog_posts, radar_critical, radar_important
        FROM network_stats;
      DROP TABLE network_stats;
      ALTER TABLE network_stats_new RENAME TO network_stats;
      CREATE INDEX IF NOT EXISTS idx_network_stats_at ON network_stats(snapshot_at DESC);
      COMMIT;
    `);
    console.log('[sync-network-stats] migrated network_stats: dropped the template columns');
  }

  const c = (sql: string, ...params: unknown[]) =>
    (db.prepare(sql).get(...params) as { c: number }).c;

  const snapshot: Snapshot = {
    snapshot_at: new Date().toISOString(),
    forum_topics: c('SELECT COUNT(*) c FROM forum_topics'),
    forum_posts: c('SELECT COUNT(*) c FROM forum_posts'),
    // No repo carve-out: the excluded repo that another deployment carves out does not exist here,
    // and with the constant gone the placeholder bound to undefined, making the
    // comparison NULL and every snapshot record 0 open / 0 closed.
    github_items_open: c("SELECT COUNT(*) c FROM github_items WHERE state = 'open'"),
    github_items_closed: c("SELECT COUNT(*) c FROM github_items WHERE state = 'closed'"),
    docs: c('SELECT COUNT(*) c FROM doc_pages'),
    videos: c('SELECT COUNT(*) c FROM youtube_videos'),
    blog_posts: c('SELECT COUNT(*) c FROM blog_posts'),
    // expires_at is stored ISO-with-Z (radar_items.expires_at); datetime('now')
    // is SQLite's own space-separated, zoneless shape. Comparing those as text
    // decides the outcome at the 'T' vs ' ' byte before the actual instants are
    // even considered, the same shape check-formats' G2 found live in several
    // *_synced_at columns. isoNowSql() generates the boundary in the stored
    // shape so the comparison is a true instant compare, not a text accident.
    radar_critical: c(`SELECT COUNT(*) c FROM radar_items WHERE level = 'critical' AND (expires_at IS NULL OR expires_at > ${isoNowSql()})`),
    radar_important: c(`SELECT COUNT(*) c FROM radar_items WHERE level = 'important' AND (expires_at IS NULL OR expires_at > ${isoNowSql()})`),
  };

  db.prepare(`
    INSERT INTO network_stats (
      snapshot_at,
      forum_topics, forum_posts,
      github_items_open, github_items_closed,
      docs, videos, blog_posts,
      radar_critical, radar_important
    ) VALUES (
      @snapshot_at,
      @forum_topics, @forum_posts,
      @github_items_open, @github_items_closed,
      @docs, @videos, @blog_posts,
      @radar_critical, @radar_important
    )
  `).run(snapshot);

  // Keep last 365 snapshots (about 6 months of 6h snapshots)
  db.prepare(`
    DELETE FROM network_stats
    WHERE id NOT IN (SELECT id FROM network_stats ORDER BY snapshot_at DESC LIMIT 365)
  `).run();

  const remaining = c('SELECT COUNT(*) c FROM network_stats');
  console.log(`Network stats snapshot stored. Forum: ${snapshot.forum_topics} topics, Docs: ${snapshot.docs}. Total snapshots: ${remaining}`);
}

guardSync('network-stats', main).catch((err) => {
  console.error('sync-network-stats failed:', err);
  process.exit(1);
});
