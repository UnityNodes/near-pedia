import { getDb } from './db';

// Single source of truth for the live "knowledge layer" inventory.
// Read by /api/v1/sources (public REST), components/sources-live.tsx (widget),
// and SSR on /sources (page hero).

export interface SourceEntry {
  type: string;
  desc: string;
  count: number;
  last_synced: string | null;
}

export interface SourceInventory {
  total_records: number;
  source_count: number;
  mcp_tools_count: number;
  sources: SourceEntry[];
}

function safeCount(db: ReturnType<typeof getDb>, table: string): number {
  try { return (db.prepare(`SELECT COUNT(*) c FROM "${table}"`).get() as { c: number }).c; }
  catch { return 0; }
}

function safeMax(db: ReturnType<typeof getDb>, table: string, col: string): string | null {
  try { return (db.prepare(`SELECT MAX("${col}") m FROM "${table}"`).get() as { m: string | null }).m; }
  catch { return null; }
}

async function mcpToolCount(): Promise<number> {
  const url = process.env.MCP_HEALTH_URL ?? 'http://127.0.0.1:3131/health';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!res.ok) return 0;
    const j = (await res.json()) as { tools?: number };
    return typeof j.tools === 'number' ? j.tools : 0;
  } catch { return 0; }
}

export async function getSourceInventory(): Promise<SourceInventory> {
  const db = getDb();

  const map: { type: string; table: string; synced: string }[] = [
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

  function countFor(type: string, table: string): number {
    if (type === 'blog_post') {
      try { return (db.prepare("SELECT COUNT(*) c FROM blog_posts WHERE tags IS NULL OR tags NOT LIKE '%release-notes%'").get() as { c: number }).c; }
      catch { return safeCount(db, table); }
    }
    return safeCount(db, table);
  }

  const sources: SourceEntry[] = map
    .map(({ type, table, synced }) => ({
      type,
      desc: '',
      count: countFor(type, table),
      last_synced: safeMax(db, table, synced),
    }))
    .filter((s) => s.count > 0);

  const ragCount = safeCount(db, 'embedding_chunks');
  sources.push({ type: 'embedding_chunk', desc: '', count: ragCount, last_synced: null });

  const totalRecords = sources
    .filter((s) => s.type !== 'embedding_chunk')
    .reduce((sum, s) => sum + s.count, 0);

  return {
    total_records: totalRecords,
    source_count: sources.filter((s) => s.type !== 'embedding_chunk').length,
    mcp_tools_count: await mcpToolCount(),
    sources,
  };
}
