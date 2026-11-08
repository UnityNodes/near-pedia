import type Database from 'better-sqlite3';

export const SOURCE_TABLES: ReadonlyArray<{ type: string; table: string; synced: string }> = [
  { type: 'doc',               table: 'doc_pages',           synced: 'synced_at' },
  { type: 'blog_post',         table: 'blog_posts',          synced: 'synced_at' },
  { type: 'forum_topic',       table: 'forum_topics',        synced: 'synced_at' },
  { type: 'youtube_video',     table: 'youtube_videos',      synced: 'synced_at' },
  { type: 'github_item',       table: 'github_items',        synced: 'synced_at' },
  { type: 'github_release',    table: 'github_releases',     synced: 'synced_at' },
  { type: 'github_discussion', table: 'github_discussions',  synced: 'synced_at' },
  { type: 'ecosystem_project', table: 'ecosystem_projects',  synced: 'synced_at' },
  { type: 'package',           table: 'packages',            synced: 'synced_at' },
  { type: 'github_repo',       table: 'github_repos',        synced: 'synced_at' },
  { type: 'hos_proposal',      table: 'hos_proposals',       synced: 'synced_at' },
  { type: 'incident',          table: 'incidents',           synced: 'synced_at' },
  { type: 'nep_standard',      table: 'nep_standards',       synced: 'synced_at' },
  { type: 'radar_item',        table: 'radar_items',         synced: 'created_at' },
];

export function sourceLastSynced(db: Database.Database, type: string): string | null {
  const src = SOURCE_TABLES.find((s) => s.type === type);
  if (!src) return null;
  try { return (db.prepare(`SELECT MAX("${src.synced}") m FROM "${src.table}"`).get() as { m: string | null }).m; }
  catch { return null; }
}
