import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { SOURCE_TABLES, sourceLastSynced } from '@/lib/source-sync';

describe('sourceLastSynced', () => {
  it('reads MAX(synced_at), not the newest post or publish date', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE forum_topics (id INTEGER, last_post_at TEXT, synced_at TEXT)');
    db.prepare('INSERT INTO forum_topics VALUES (?, ?, ?)').run(1, '2026-11-08T09:00:00Z', '2026-11-07T10:00:00Z');
    db.prepare('INSERT INTO forum_topics VALUES (?, ?, ?)').run(2, '2026-11-01T09:00:00Z', '2026-11-08T06:00:00Z');
    expect(sourceLastSynced(db, 'forum_topic')).toBe('2026-11-08T06:00:00Z');
  });

  it('uses created_at for the radar and null for a missing table or an unknown type', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE radar_items (id INTEGER, created_at TEXT)');
    db.prepare('INSERT INTO radar_items VALUES (?, ?)').run(1, '2026-11-05T00:00:00Z');
    expect(sourceLastSynced(db, 'radar_item')).toBe('2026-11-05T00:00:00Z');
    expect(sourceLastSynced(db, 'doc')).toBeNull();
    expect(sourceLastSynced(db, 'nope')).toBeNull();
  });

  it('is what /api/v1/sources reports for every source it lists', () => {
    const server = fs.readFileSync(path.resolve(__dirname, '../../mcp-server.ts'), 'utf8');
    const block = server.slice(server.indexOf('const allSources = ['), server.indexOf('];', server.indexOf('const allSources = [')));
    const rows = [...block.matchAll(/\{ type: '(\w+)',.*last_synced: (.*) \}/g)].map((m) => ({ type: m[1], expr: m[2] }));
    expect(rows.length).toBe(SOURCE_TABLES.length);
    for (const r of rows) expect(r.expr).toBe(`sourceLastSynced(db, '${r.type}')`);
    expect(rows.map((r) => r.type).sort()).toEqual(SOURCE_TABLES.map((s) => s.type).sort());
  });
});
