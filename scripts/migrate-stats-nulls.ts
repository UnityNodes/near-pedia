/**
 * One-shot repair: mark the github_items counters that were never actually
 * measured as NULL instead of 0.
 *
 * sync-network-stats filtered on a constant that had been deleted, so the bound
 * parameter was undefined and `repo != NULL` matched nothing. Every snapshot
 * between 2026-06-19 and 2026-07-18 therefore recorded 0 open / 0 closed while
 * github_items actually held over a thousand rows.
 *
 * Those zeros are not data - they are a broken query's output - and on /stats
 * they render as a cliff to the floor and back, which reads as "the site lost
 * all its issues". NULL is the honest value: not measured. The columns are
 * NOT NULL, so the table has to be rebuilt to allow it.
 *
 * Only rows where BOTH counters are 0 are cleared: a legitimate snapshot always
 * had a non-zero closed count alongside a non-zero open count.
 */
import 'dotenv/config';
import { getDb } from '../lib/db';

function main() {
  const db = getDb();

  const cols = db.prepare('PRAGMA table_info(network_stats)').all() as Array<{
    name: string; notnull: number;
  }>;
  const openCol = cols.find((c) => c.name === 'github_items_open');
  if (!openCol) throw new Error('network_stats has no github_items_open column');

  const affected = (db.prepare(
    'SELECT COUNT(*) c FROM network_stats WHERE github_items_open = 0 AND github_items_closed = 0',
  ).get() as { c: number }).c;

  if (openCol.notnull === 1) {
    db.exec(`
      BEGIN;
      CREATE TABLE network_stats_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_at TEXT NOT NULL,
        cips INTEGER NOT NULL, cips_in_review INTEGER NOT NULL, cips_final INTEGER NOT NULL,
        forum_topics INTEGER NOT NULL, forum_posts INTEGER NOT NULL,
        github_items_open INTEGER, github_items_closed INTEGER,
        docs INTEGER NOT NULL, videos INTEGER NOT NULL, blog_posts INTEGER NOT NULL,
        radar_critical INTEGER NOT NULL, radar_important INTEGER NOT NULL
      );
      INSERT INTO network_stats_new
        SELECT id, snapshot_at, cips, cips_in_review, cips_final,
               forum_topics, forum_posts, github_items_open, github_items_closed,
               docs, videos, blog_posts, radar_critical, radar_important
        FROM network_stats;
      DROP TABLE network_stats;
      ALTER TABLE network_stats_new RENAME TO network_stats;
      CREATE INDEX IF NOT EXISTS idx_network_stats_at ON network_stats(snapshot_at DESC);
      COMMIT;
    `);
    console.log('[migrate-stats-nulls] github_items counters are now nullable');
  }

  const res = db.prepare(`
    UPDATE network_stats
    SET github_items_open = NULL, github_items_closed = NULL
    WHERE github_items_open = 0 AND github_items_closed = 0
  `).run();

  const remaining = (db.prepare(
    'SELECT COUNT(*) c FROM network_stats WHERE github_items_open IS NULL',
  ).get() as { c: number }).c;
  const total = (db.prepare('SELECT COUNT(*) c FROM network_stats').get() as { c: number }).c;

  console.log(
    `[migrate-stats-nulls] ${affected} unmeasured snapshots found, ${res.changes} cleared; ` +
    `${remaining}/${total} rows now carry NULL github counters`,
  );
}

main();
