import { getDb } from '../lib/db';
import { guardSync } from '../lib/sync-log';
import { isoNowSql } from '../lib/formats';

interface TrendingItem {
  src: string;
  id: string;
  title: string;
  path: string;
  score: number;
}

function main() {
  const db = getDb();

  const forumItems = db.prepare(`
    SELECT 'forum' as src, CAST(id as TEXT) as id, title,
      '/discussions/' || id as path,
      (SELECT COUNT(*) FROM forum_posts fp WHERE fp.topic_id = ft.id AND fp.created_at > datetime('now','-7 days'))
        + 2 * like_count
      as score
    FROM forum_topics ft
    WHERE last_post_at > datetime('now','-7 days')
    ORDER BY score DESC
    LIMIT 20
  `).all() as TrendingItem[];

  const cipItems = db.prepare(`
    SELECT 'cip' as src, id, title,
      '/cips/' || id as path,
      5 as score
    FROM cips
    WHERE synced_at > datetime('now','-7 days')
    ORDER BY cip_number DESC
    LIMIT 10
  `).all() as TrendingItem[];

  const githubItems = db.prepare(`
    SELECT 'github' as src, id, title,
      -- id is "org/repo#number" (e.g. "your-org/yoursdk#3254"). Concatenated
      -- onto /proposals/ raw, the '#' becomes a URL FRAGMENT, not a path
      -- segment: the browser never sends "3254" to the server at all, and
      -- /proposals/your-org/yoursdk 404s. lib/source-urls.ts's
      -- buildSourceLink already gets this right for the same id shape
      -- (sourceId.replace('#', '/')); REPLACE() is the SQL equivalent.
      '/proposals/' || REPLACE(id, '#', '/') as path,
      2 as score
    FROM github_items
    WHERE synced_at > datetime('now','-7 days')
    ORDER BY synced_at DESC
    LIMIT 10
  `).all() as TrendingItem[];

  const all = [...forumItems, ...cipItems, ...githubItems]
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);

  db.prepare(`
    INSERT INTO trending_snapshot (id, payload, updated_at)
    VALUES (1, ?, ${isoNowSql()})
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `).run(JSON.stringify(all));

  console.log(`[trending] refreshed ${all.length} items`);
  db.close();
  return all.length;
}

guardSync('trending', main).catch(e => { console.error(e); process.exit(1); });
