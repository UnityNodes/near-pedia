// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';

// Use in-memory DB for tests — must be set before import
process.env.DB_PATH = ':memory:';

import { getDb, resetDb } from '@/lib/db';

describe('getDb', () => {
  beforeEach(() => {
    resetDb();
  });

  it('creates forum_topics table', () => {
    const db = getDb();
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='forum_topics'"
    ).get();
    expect(row).toBeTruthy();
  });

  it('creates sync_log table', () => {
    const db = getDb();
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sync_log'"
    ).get();
    expect(row).toBeTruthy();
  });

});

describe('sqlite-vec tables', () => {
  beforeEach(() => { resetDb(); });

  it('creates embedding_chunks table', () => {
    const db = getDb();
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='embedding_chunks'"
    ).get();
    expect(row).toBeTruthy();
  });

  it('embedding_chunks has unique constraint on source_type+source_id+chunk_index', () => {
    const db = getDb();
    db.prepare(
      'INSERT INTO embedding_chunks (source_type, source_id, chunk_index, chunk_text) VALUES (?,?,?,?)'
    ).run('doc_page', '1', 0, 'hello');
    expect(() =>
      db.prepare(
        'INSERT INTO embedding_chunks (source_type, source_id, chunk_index, chunk_text) VALUES (?,?,?,?)'
      ).run('doc_page', '1', 0, 'hello again')
    ).toThrow();
  });
});
