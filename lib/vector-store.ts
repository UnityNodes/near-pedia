import { createHash } from 'node:crypto';
import { getDb } from './db';

export interface Chunk {
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  chunkText: string;
}

export interface SearchResult extends Chunk {
  distance: number;
}

/**
 * Split text into overlapping chunks, preferring natural boundaries
 * (paragraph > newline > sentence) inside the last `overlap` window so
 * we don't cut sentences or `.go`/code blocks mid-line. Falls back to
 * a hard slice when no boundary is found.
 */
export function chunkText(text: string, chunkSize = 3200, overlap = 400): string[] {
  if (overlap >= chunkSize) {
    throw new Error(`overlap (${overlap}) must be less than chunkSize (${chunkSize})`);
  }
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= chunkSize) return [trimmed];
  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    let end = Math.min(start + chunkSize, trimmed.length);
    if (end < trimmed.length) {
      // Look for a clean break in the tail window [end-overlap, end).
      const windowStart = Math.max(start + Math.floor(chunkSize / 2), end - overlap);
      const slice = trimmed.slice(windowStart, end);
      const para = slice.lastIndexOf('\n\n');
      const nl = para === -1 ? slice.lastIndexOf('\n') : -1;
      const sent = para === -1 && nl === -1 ? slice.lastIndexOf('. ') : -1;
      if (para !== -1) end = windowStart + para + 2;
      else if (nl !== -1) end = windowStart + nl + 1;
      else if (sent !== -1) end = windowStart + sent + 1;
    }
    const piece = trimmed.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= trimmed.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

export function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function getDocHash(sourceType: string, sourceId: string): string | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT content_hash FROM embedding_doc_hash WHERE source_type=? AND source_id=?'
  ).get(sourceType, sourceId) as { content_hash: string } | undefined;
  return row?.content_hash ?? null;
}

export function setDocHash(sourceType: string, sourceId: string, hash: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO embedding_doc_hash (source_type, source_id, content_hash, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(source_type, source_id)
     DO UPDATE SET content_hash = excluded.content_hash, updated_at = excluded.updated_at`
  ).run(sourceType, sourceId, hash, Date.now());
}

/**
 * Remove all chunks AND their vectors for one source document. Used when a
 * source's content changed so stale chunks don't linger. The FTS mirror is
 * cleaned by the AFTER DELETE trigger on embedding_chunks.
 */
export function deleteSourceEmbeddings(sourceType: string, sourceId: string): number {
  const db = getDb();
  const ids = db.prepare(
    'SELECT id FROM embedding_chunks WHERE source_type=? AND source_id=?'
  ).all(sourceType, sourceId) as Array<{ id: number }>;
  const delHash = db.prepare('DELETE FROM embedding_doc_hash WHERE source_type=? AND source_id=?');
  const delVec = db.prepare('DELETE FROM embedding_vectors WHERE rowid = ?');
  const delChunk = db.prepare('DELETE FROM embedding_chunks WHERE id = ?');
  // The hash row goes with the chunks, in the same transaction, and even when no
  // chunks were left. A pruned source otherwise keeps a manifest entry for a
  // document we no longer hold, and whatever later takes its id is compared
  // against a stranger's hash.
  db.transaction(() => {
    delHash.run(sourceType, sourceId);
    for (const { id } of ids) {
      try { delVec.run(BigInt(id)); } catch { /* vec0 not loaded */ }
      delChunk.run(id);
    }
  })();
  return ids.length;
}

export function upsertChunk(chunk: Chunk): void {
  const db = getDb();
  db.prepare(
    'INSERT OR IGNORE INTO embedding_chunks (source_type, source_id, chunk_index, chunk_text) VALUES (?, ?, ?, ?)'
  ).run(chunk.sourceType, chunk.sourceId, chunk.chunkIndex, chunk.chunkText);
}

export function upsertVector(chunkId: number, embedding: number[]): void {
  const db = getDb();
  const id = BigInt(chunkId);
  const existing = db.prepare('SELECT rowid FROM embedding_vectors WHERE rowid = ?').get(id);
  if (existing) return;
  try {
    db.prepare('INSERT INTO embedding_vectors (rowid, embedding) VALUES (?, ?)').run(id, JSON.stringify(embedding));
  } catch (e) {
    // vec0 has no INSERT OR IGNORE, and its rowid existence check can race a
    // concurrent embed run (e.g. cron tick overlapping a manual rebuild). A
    // UNIQUE collision just means the vector is already present - safe to skip.
    if (!/UNIQUE|constraint/i.test(String((e as Error).message))) throw e;
  }
}

export function getChunkId(chunk: Omit<Chunk, 'chunkText'>): number | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT id FROM embedding_chunks WHERE source_type=? AND source_id=? AND chunk_index=?'
  ).get(chunk.sourceType, chunk.sourceId, chunk.chunkIndex) as { id: number } | undefined;
  return row?.id ?? null;
}

export function hasEmbedding(chunkId: number): boolean {
  const db = getDb();
  return db.prepare('SELECT rowid FROM embedding_vectors WHERE rowid = ?').get(BigInt(chunkId)) != null;
}

export function searchSimilar(queryEmbedding: number[], limit = 5): SearchResult[] {
  try {
    const db = getDb();
    const rows = db.prepare(`
      WITH knn AS (
        SELECT rowid, distance FROM embedding_vectors WHERE embedding MATCH ? ORDER BY distance LIMIT ?
      )
      SELECT ec.source_type, ec.source_id, ec.chunk_index, ec.chunk_text, knn.distance
      FROM knn JOIN embedding_chunks ec ON ec.id = knn.rowid
    `).all(JSON.stringify(queryEmbedding), limit) as Array<{
      source_type: string; source_id: string; chunk_index: number; chunk_text: string; distance: number;
    }>;
    return rows.map(r => ({
      sourceType: r.source_type, sourceId: r.source_id,
      chunkIndex: r.chunk_index, chunkText: r.chunk_text, distance: r.distance,
    }));
  } catch {
    return [];
  }
}

/**
 * Return a chunk merged with its neighbours from the same source document
 * (chunk_index within ±radius), in order. Long operational docs get split
 * across many chunks; the exact command an answer needs often lives in the
 * chunk *next to* the one that ranked. Pulling the window keeps the section
 * intact. Returns '' when there are no neighbours (so callers can fall back to
 * the single chunk). Capped at maxChars to bound LLM context growth.
 */
export function getChunkWindow(
  sourceType: string, sourceId: string, chunkIndex: number, radius = 1, maxChars = 4200,
): string {
  const db = getDb();
  const rows = db.prepare(
    `SELECT chunk_index, chunk_text FROM embedding_chunks
     WHERE source_type=? AND source_id=? AND chunk_index BETWEEN ? AND ?
     ORDER BY chunk_index`
  ).all(sourceType, sourceId, chunkIndex - radius, chunkIndex + radius) as Array<{ chunk_index: number; chunk_text: string }>;
  if (rows.length <= 1) return '';
  const text = rows.map(r => r.chunk_text).join('\n');
  return text.length > maxChars ? text.slice(0, maxChars) + '…' : text;
}

// FTS5 search returns chunks ranked by BM25 score (lower = better)
function searchFts(query: string, limit = 20): Array<{ rowid: number; rank: number }> {
  try {
    const db = getDb();
    // Sanitize: extract alphanumeric tokens, ignore punctuation/operators
    const tokens = query.match(/[\p{L}\p{N}_-]+/gu)?.filter(t => t.length > 1).slice(0, 8) ?? [];
    if (tokens.length === 0) return [];
    // Build FTS5 query: each token prefix-matched, joined with OR
    const ftsQuery = tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(' OR ');
    return db.prepare(`
      SELECT rowid, rank FROM embedding_chunks_fts WHERE embedding_chunks_fts MATCH ? ORDER BY rank LIMIT ?
    `).all(ftsQuery, limit) as Array<{ rowid: number; rank: number }>;
  } catch {
    return [];
  }
}

/**
 * Hybrid search using Reciprocal Rank Fusion (RRF) of vector + FTS results.
 * RRF score: 1/(k + rank) where k=60 is standard. Combines rankings from both methods,
 * giving higher scores to chunks that appear high in either ranking.
 */
export function hybridSearch(
  queryEmbedding: number[] | null,
  queryText: string,
  limit = 6,
  poolSize = 20,
): SearchResult[] {
  try {
    const db = getDb();

    // Vector search top N
    const vecRows = queryEmbedding === null ? [] : db.prepare(`
      SELECT rowid FROM embedding_vectors WHERE embedding MATCH ? ORDER BY distance LIMIT ?
    `).all(JSON.stringify(queryEmbedding), poolSize) as Array<{ rowid: number | bigint }>;

    // FTS search top N
    const ftsRows = searchFts(queryText, poolSize);

    // RRF scoring
    const k = 60;
    const scores = new Map<number, number>();
    vecRows.forEach((r, i) => {
      const id = Number(r.rowid);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    });
    ftsRows.forEach((r, i) => {
      const id = Number(r.rowid);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    });

    if (scores.size === 0) return [];

    const topIds = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);

    // Fetch chunk data for selected IDs (preserve RRF order)
    const placeholders = topIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT id, source_type, source_id, chunk_index, chunk_text
      FROM embedding_chunks WHERE id IN (${placeholders})
    `).all(...topIds) as Array<{ id: number; source_type: string; source_id: string; chunk_index: number; chunk_text: string }>;

    const byId = new Map(rows.map(r => [r.id, r]));
    return topIds
      .map(id => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined)
      .map(r => ({
        sourceType: r.source_type,
        sourceId: r.source_id,
        chunkIndex: r.chunk_index,
        chunkText: r.chunk_text,
        distance: 1 - (scores.get(r.id) ?? 0), // pseudo-distance: lower = better
      }));
  } catch {
    return queryEmbedding === null ? [] : searchSimilar(queryEmbedding, limit);
  }
}
