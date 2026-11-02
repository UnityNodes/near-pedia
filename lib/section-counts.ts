import { getDb } from './db';

const COUNT_SQL: Record<string, string> = {
  '/docs': 'SELECT COUNT(*) c FROM doc_pages',
  '/releases': 'SELECT COUNT(*) c FROM github_releases',
  '/videos': 'SELECT COUNT(*) c FROM youtube_videos',
  '/blog': 'SELECT COUNT(*) c FROM blog_posts',
  '/discussions': 'SELECT COUNT(*) c FROM forum_topics',
  '/code': 'SELECT COUNT(*) c FROM github_items',
  '/ecosystem': 'SELECT COUNT(*) c FROM ecosystem_projects',
};

export function getSectionCounts(): Record<string, number> {
  const db = getDb();
  const out: Record<string, number> = {};
  for (const [href, sql] of Object.entries(COUNT_SQL)) {
    try {
      out[href] = (db.prepare(sql).get() as { c: number }).c;
    } catch {
      continue;
    }
  }
  return out;
}

export function getLastSync(table: string, column = 'synced_at'): string | null {
  try {
    const row = getDb().prepare(`SELECT MAX("${column}") m FROM "${table}"`).get() as { m: string | null };
    return row.m;
  } catch {
    return null;
  }
}
