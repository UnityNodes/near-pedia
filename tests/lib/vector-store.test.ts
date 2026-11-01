// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';

process.env.DB_PATH = ':memory:';

import { getDb, resetDb } from '@/lib/db';
import {
  upsertChunk, searchSimilar, chunkText, getChunkId, hasEmbedding,
  hashContent, getDocHash, setDocHash, deleteSourceEmbeddings,
} from '@/lib/vector-store';

describe('chunkText', () => {
  it('returns single chunk for short text', () => {
    const chunks = chunkText('hello world', 3200, 400);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('hello world');
  });

  it('splits long text into multiple chunks', () => {
    const text = 'a'.repeat(10000);
    const chunks = chunkText(text, 3200, 400);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBeLessThanOrEqual(3200);
  });

  it('returns empty array for empty text', () => {
    const chunks = chunkText('', 3200, 400);
    expect(chunks).toHaveLength(0);
  });

  it('throws when overlap >= chunkSize', () => {
    expect(() => chunkText('some text', 100, 100)).toThrow('overlap');
  });

  it('prefers a paragraph boundary over a hard cut', () => {
    // First paragraph fills past the half-window; a "\n\n" sits inside the
    // tail window before the hard limit, so the first chunk should end there.
    const para1 = 'A'.repeat(70);
    const para2 = 'B'.repeat(70);
    const chunks = chunkText(`${para1}\n\n${para2}`, 100, 40);
    expect(chunks[0]).toBe(para1);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('always makes forward progress (no infinite loop) on boundary-free text', () => {
    const chunks = chunkText('x'.repeat(5000), 1000, 200);
    expect(chunks.length).toBeGreaterThan(1);
    // Reassembled (minus overlap) it still covers the whole input.
    expect(chunks.join('').length).toBeGreaterThanOrEqual(5000);
  });
});

describe('content-hash invalidation', () => {
  beforeEach(() => { resetDb(); });

  it('hashContent is stable and content-sensitive', () => {
    expect(hashContent('hello')).toBe(hashContent('hello'));
    expect(hashContent('hello')).not.toBe(hashContent('hello!'));
  });

  it('get/setDocHash round-trips and upserts', () => {
    expect(getDocHash('cip', '0001')).toBeNull();
    setDocHash('cip', '0001', 'hash-a');
    expect(getDocHash('cip', '0001')).toBe('hash-a');
    setDocHash('cip', '0001', 'hash-b');
    expect(getDocHash('cip', '0001')).toBe('hash-b');
  });

  it('deleteSourceEmbeddings removes only the target source chunks', () => {
    upsertChunk({ sourceType: 'cip', sourceId: '0001', chunkIndex: 0, chunkText: 'a' });
    upsertChunk({ sourceType: 'cip', sourceId: '0001', chunkIndex: 1, chunkText: 'b' });
    upsertChunk({ sourceType: 'cip', sourceId: '0002', chunkIndex: 0, chunkText: 'c' });
    const removed = deleteSourceEmbeddings('cip', '0001');
    expect(removed).toBe(2);
    const db = getDb();
    const left = db.prepare(
      'SELECT source_id, COUNT(*) n FROM embedding_chunks GROUP BY source_id'
    ).all() as Array<{ source_id: string; n: number }>;
    expect(left).toEqual([{ source_id: '0002', n: 1 }]);
  });

  it('deleteSourceEmbeddings on an absent source is a no-op returning 0', () => {
    expect(deleteSourceEmbeddings('cip', 'nope')).toBe(0);
  });
});

describe('upsertChunk', () => {
  beforeEach(() => { resetDb(); });

  it('inserts a chunk without error', () => {
    expect(() =>
      upsertChunk({ sourceType: 'cip', sourceId: '0001', chunkIndex: 0, chunkText: 'YourChain privacy CIP' })
    ).not.toThrow();
  });

  it('is idempotent — second insert with same key is ignored', () => {
    upsertChunk({ sourceType: 'cip', sourceId: '0001', chunkIndex: 0, chunkText: 'first' });
    upsertChunk({ sourceType: 'cip', sourceId: '0001', chunkIndex: 0, chunkText: 'second' });
    const db = getDb();
    const row = db.prepare(
      'SELECT chunk_text FROM embedding_chunks WHERE source_type=? AND source_id=? AND chunk_index=?'
    ).get('cip', '0001', 0) as { chunk_text: string } | undefined;
    expect(row?.chunk_text).toBe('first');
  });
});

describe('searchSimilar', () => {
  beforeEach(() => { resetDb(); });

  it('returns empty array when no embeddings are stored', () => {
    const results = searchSimilar(Array(512).fill(0.1), 5);
    expect(results).toHaveLength(0);
  });
});

describe('getChunkId', () => {
  beforeEach(() => { resetDb(); });

  it('returns null for non-existent chunk', () => {
    const result = getChunkId({ sourceType: 'cip', sourceId: '9999', chunkIndex: 0 });
    expect(result).toBeNull();
  });

  it('returns id after upsertChunk', () => {
    upsertChunk({ sourceType: 'cip', sourceId: '0001', chunkIndex: 0, chunkText: 'hello' });
    const id = getChunkId({ sourceType: 'cip', sourceId: '0001', chunkIndex: 0 });
    expect(id).toBeTypeOf('number');
    expect(id).toBeGreaterThan(0);
  });
});

describe('hasEmbedding', () => {
  beforeEach(() => { resetDb(); });

  it('returns false for non-existent chunkId', () => {
    expect(hasEmbedding(99999)).toBe(false);
  });
});
