import { getDb } from './db';
import { SOURCE_TABLES, sourceLastSynced } from './source-sync';

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

  function countFor(type: string, table: string): number {
    if (type === 'blog_post') {
      try { return (db.prepare("SELECT COUNT(*) c FROM blog_posts WHERE tags IS NULL OR tags NOT LIKE '%release-notes%'").get() as { c: number }).c; }
      catch { return safeCount(db, table); }
    }
    return safeCount(db, table);
  }

  const sources: SourceEntry[] = SOURCE_TABLES
    .map(({ type, table }) => ({
      type,
      desc: '',
      count: countFor(type, table),
      last_synced: sourceLastSynced(db, type),
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
