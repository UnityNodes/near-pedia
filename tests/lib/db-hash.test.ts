import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { hashDatabase, hashedTables } from '@/lib/db-hash';

function db(order: 'asc' | 'desc' = 'asc') {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE packages (name TEXT PRIMARY KEY, latest TEXT, size INTEGER);
    CREATE TABLE sync_log (id INTEGER PRIMARY KEY, source TEXT);
    CREATE VIRTUAL TABLE docs_fts USING fts5(title);
    CREATE TABLE embedding_vectors (id INTEGER, v BLOB);`);
  const rows = [['near-api-js', '7.4.0', BigInt('9007199254740993')], ['near-sdk-js', '2.0.0', BigInt(1)], ['@near-js/accounts', '2.5.1', null]];
  const ins = d.prepare('INSERT INTO packages VALUES (?, ?, ?)');
  for (const r of order === 'asc' ? rows : [...rows].reverse()) ins.run(...r);
  d.prepare("INSERT INTO sync_log (source) VALUES ('docs')").run();
  d.prepare("INSERT INTO docs_fts (title) VALUES ('x')").run();
  return d;
}

describe('db_anchors', () => {
  it('refuses to change or delete a recorded anchor', async () => {
    const { initNearSchema } = await import('@/lib/near-schema');
    const d = new Database(':memory:');
    initNearSchema(d);
    d.prepare(`INSERT INTO db_anchors (date, hash, tables, rows, manifest, computed_at, status) VALUES ('2026-11-01', ?, 1, 1, '[]', 'now', 'recorded')`).run('a'.repeat(64));
    expect(() => d.prepare("UPDATE db_anchors SET hash = 'b' WHERE date = '2026-11-01'").run()).toThrow(/final/);
    expect(() => d.prepare("DELETE FROM db_anchors WHERE date = '2026-11-01'").run()).toThrow(/final/);
  });
});

describe('hashDatabase', () => {
  it('hashes content, not insertion order', () => {
    expect(hashDatabase(db('asc')).hash).toBe(hashDatabase(db('desc')).hash);
  });

  it('changes with one value, and reads integers past 2^53 exactly', () => {
    const a = db();
    const b = db();
    b.prepare("UPDATE packages SET size = 9007199254740992 WHERE name = 'near-api-js'").run();
    expect(hashDatabase(a).hash).not.toBe(hashDatabase(b).hash);
  });

  it('is unaffected by operational tables and derived indexes', () => {
    const a = db();
    const b = db();
    b.prepare("INSERT INTO sync_log (source) VALUES ('forum')").run();
    b.prepare("INSERT INTO docs_fts (title) VALUES ('y')").run();
    b.prepare('INSERT INTO embedding_vectors VALUES (1, ?)').run(Buffer.from([0]));
    expect(hashDatabase(a).hash).toBe(hashDatabase(b).hash);
  });

  it('hashes a new table nobody named, and says why each skipped one is skipped', () => {
    const d = db();
    d.exec('CREATE TABLE brand_new (x TEXT)');
    const { hashed, skipped } = hashedTables(d);
    expect(hashed).toEqual(['brand_new', 'packages']);
    expect(skipped.find((s) => s.table === 'docs_fts_data')?.why).toMatch(/full-text/);
    expect(skipped.find((s) => s.table === 'sync_log')?.why).toMatch(/operational/);
    expect(hashDatabase(d).tables.map((t) => [t.table, t.rows])).toEqual([['brand_new', 0], ['packages', 3]]);
  });
});
