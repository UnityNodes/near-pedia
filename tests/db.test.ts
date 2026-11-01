// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';

// Use in-memory DB for tests — must be set before import
process.env.DB_PATH = ':memory:';

import { getDb, resetDb } from '@/lib/db';

describe('getDb', () => {
  beforeEach(() => {
    resetDb();
  });

  it('creates cips table', () => {
    const db = getDb();
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='cips'"
    ).get();
    expect(row).toBeTruthy();
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

  it('inserts and reads a cip', () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO cips (id, cip_number, title, status) VALUES (?, ?, ?, ?)`
    ).run('0100', 100, 'Test CIP', 'Draft');
    const cip = db.prepare('SELECT * FROM cips WHERE id = ?').get('0100') as { title: string; status: string };
    expect(cip.title).toBe('Test CIP');
    expect(cip.status).toBe('Draft');
  });

  it('has index on cips.status', () => {
    const db = getDb();
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_cips_status'"
    ).get();
    expect(row).toBeTruthy();
  });

  it('has index on cips.type', () => {
    const db = getDb();
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_cips_type'"
    ).get();
    expect(row).toBeTruthy();
  });

  it('has index on cips.author', () => {
    const db = getDb();
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_cips_author'"
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
    ).run('cip', '0001', 0, 'hello');
    expect(() =>
      db.prepare(
        'INSERT INTO embedding_chunks (source_type, source_id, chunk_index, chunk_text) VALUES (?,?,?,?)'
      ).run('cip', '0001', 0, 'hello again')
    ).toThrow();
  });
});
