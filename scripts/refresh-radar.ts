/**
 * The NEAR Radar into radar_items, from the state the other syncs hold
 * (lib/near-radar.ts decides what is on it and until when).
 *
 * Each run writes the current set and retires every live item the set no
 * longer contains, by moving its expires_at to now: a resolved upgrade, a
 * closed vote or a draft that went on chain leaves the radar on the next
 * run, not at its estimated date. Only the source types read on this run
 * are retired, plus types lib/near-radar.ts no longer produces at all. Rows
 * are kept, expired, for the history /api/v1/radar?include_expired=true
 * serves.
 *
 *   npx tsx scripts/refresh-radar.ts
 */

import { getDb } from '../lib/db';
import { guardSync, logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import type Database from 'better-sqlite3';
import { RADAR_SOURCE_TYPES, collectRadar } from '../lib/near-radar';
import { radarLiveSql } from '../lib/constants';

const PRODUCED: ReadonlySet<string> = new Set(RADAR_SOURCE_TYPES);

export function refreshRadar(db: Database.Database, now: Date = new Date()): { live: number; retired: number; unread: string[] } {
  const nowIso = now.toISOString();
  const { items, read } = collectRadar(db, now);

  const upsert = db.prepare(`
    INSERT INTO radar_items (level, title, body, source_type, source_id, source_url, affects, deadline, published_at, expires_at, created_at)
    VALUES (@level, @title, @body, @sourceType, @sourceId, @url, @affects, @deadline, @publishedAt, @expiresAt, @now)
    ON CONFLICT(source_type, source_id) DO UPDATE SET
      level = excluded.level, title = excluded.title, body = excluded.body, source_url = excluded.source_url,
      affects = excluded.affects, deadline = excluded.deadline, published_at = excluded.published_at, expires_at = excluded.expires_at
  `);
  const live = db.prepare(`SELECT id, source_type, source_id FROM radar_items WHERE ${radarLiveSql('', 'param')}`);
  const retire = db.prepare('UPDATE radar_items SET expires_at = ? WHERE id = ?');

  let retired = 0;
  db.transaction(() => {
    for (const c of items) upsert.run({ ...c, affects: JSON.stringify(c.affects), now: nowIso });
    const current = new Set(items.map((c) => `${c.sourceType}\u0000${c.sourceId}`));
    for (const r of live.all(nowIso) as Array<{ id: number; source_type: string; source_id: string }>) {
      if (current.has(`${r.source_type}\u0000${r.source_id}`)) continue;
      if (PRODUCED.has(r.source_type) && !read.has(r.source_type as (typeof RADAR_SOURCE_TYPES)[number])) continue;
      retire.run(nowIso, r.id);
      retired++;
    }
  })();

  const by = (l: string) => items.filter((c) => c.level === l).length;
  const unread = RADAR_SOURCE_TYPES.filter((t) => !read.has(t));
  console.log(`[refresh-radar] ${items.length} live (critical ${by('critical')}, important ${by('important')}, ecosystem ${by('ecosystem')}), ${retired} retired${unread.length ? `; not read, left as they were: ${unread.join(', ')}` : ''}`);
  return { live: items.length, retired, unread };
}

function main(): number {
  const db = getDb();
  const r = refreshRadar(db);
  if (r.unread.length) logRun('radar', { status: 'partial', items: r.live, error: `sources not read (table or column missing): ${r.unread.join(', ')}` }, db);
  return r.live;
}

if (isEntrypoint(import.meta.url)) {
  guardSync('radar', main).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
