import { getDb } from './db';

export interface RelatedItem {
  sourceType: string;
  sourceId: string;
  title: string;
  path: string;
  excerpt: string | null;
}

function buildPath(type: string, id: string): string {
  if (type === 'cip') return `/cips/${id}`;
  if (type === 'forum_topic') return `/discussions/${id}`;
  if (type === 'doc_page') return `/docs/${id}`;
  if (type === 'whitepaper') return `/whitepapers/${id}`;
  if (type === 'blog_post') return `/blog/${id}`;
  return '/';
}

function fetchTitle(db: ReturnType<typeof getDb>, type: string, id: string): { title: string | null; excerpt: string | null } {
  if (type === 'cip') {
    const r = db.prepare('SELECT title FROM cips WHERE id = ?').get(id) as { title: string | null } | undefined;
    return { title: r?.title ?? null, excerpt: null };
  }
  if (type === 'forum_topic') {
    const r = db.prepare('SELECT title FROM forum_topics WHERE id = ?').get(id) as { title: string | null } | undefined;
    return { title: r?.title ?? null, excerpt: null };
  }
  if (type === 'doc_page') {
    const r = db.prepare('SELECT title, excerpt FROM doc_pages WHERE id = ?').get(id) as { title: string | null; excerpt: string | null } | undefined;
    return { title: r?.title ?? null, excerpt: r?.excerpt ?? null };
  }
  if (type === 'whitepaper') {
    const r = db.prepare('SELECT title, description FROM whitepapers WHERE id = ?').get(parseInt(id, 10)) as { title: string; description: string | null } | undefined;
    return { title: r?.title ?? null, excerpt: r?.description ?? null };
  }
  if (type === 'blog_post') {
    const r = db.prepare('SELECT title, excerpt FROM blog_posts WHERE id = ?').get(id) as { title: string | null; excerpt: string | null } | undefined;
    return { title: r?.title ?? null, excerpt: r?.excerpt ?? null };
  }
  return { title: null, excerpt: null };
}

export function getRelated(
  sourceType: string,
  sourceId: string,
  limit = 5,
): RelatedItem[] {
  const db = getDb();

  // Get the first chunk's embedding for this source
  const chunkRow = db.prepare(
    'SELECT id FROM embedding_chunks WHERE source_type = ? AND source_id = ? AND chunk_index = 0'
  ).get(sourceType, sourceId) as { id: number } | undefined;

  if (!chunkRow) return [];

  let rows: Array<{ source_type: string; source_id: string }>;
  try {
    // Get the vector for this chunk
    const vecRow = db.prepare('SELECT embedding FROM embedding_vectors WHERE rowid = ?').get(BigInt(chunkRow.id)) as { embedding: string } | undefined;
    if (!vecRow) return [];

    // Find nearest neighbors, excluding self
    rows = db.prepare(`
      WITH knn AS (
        SELECT rowid, distance FROM embedding_vectors WHERE embedding MATCH ? ORDER BY distance LIMIT ?
      )
      SELECT DISTINCT ec.source_type, ec.source_id
      FROM knn JOIN embedding_chunks ec ON ec.id = knn.rowid
      WHERE NOT (ec.source_type = ? AND ec.source_id = ?)
    `).all(vecRow.embedding, limit * 4, sourceType, sourceId) as Array<{ source_type: string; source_id: string }>;
  } catch {
    return [];
  }

  // Deduplicate by (source_type, source_id) and build items
  const seen = new Set<string>();
  const items: RelatedItem[] = [];
  for (const row of rows) {
    const key = `${row.source_type}:${row.source_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { title, excerpt } = fetchTitle(db, row.source_type, row.source_id);
    if (!title) continue;
    items.push({
      sourceType: row.source_type,
      sourceId: row.source_id,
      title,
      path: buildPath(row.source_type, row.source_id),
      excerpt,
    });
    if (items.length >= limit) break;
  }
  return items;
}
