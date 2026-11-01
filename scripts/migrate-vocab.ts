/**
 * Create the fts5vocab companion tables that lib/rank.ts reads document
 * frequencies from. Without them idf collapses to uniform and ranking is
 * effectively arbitrary.
 *
 * Idempotent - safe to run on every deploy and from the daily sync bucket:
 *   npx tsx scripts/migrate-vocab.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDb } from '../lib/db';
import { VOCAB_SOURCES } from '../lib/rank';
import { guardSync } from '../lib/sync-log';

function main() {
  const db = getDb();
  let created = 0;
  let skipped = 0;

  for (const { vocab, fts } of VOCAB_SOURCES) {
    const ftsExists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
      .get(fts);
    if (!ftsExists) {
      console.log(`  skip ${vocab} - base index ${fts} not present`);
      skipped++;
      continue;
    }
    try {
      // DROP first rather than CREATE IF NOT EXISTS: if a migration ever
      // recreated the base index, the old vocab table still "exists" while
      // pointing at a table that no longer does, and every lookup throws -
      // which rank.ts swallows, silently degrading idf to uniform. A vocab
      // table is just a view over the index, so recreating it costs nothing.
      db.exec(`DROP TABLE IF EXISTS ${vocab}`);
      db.exec(`CREATE VIRTUAL TABLE ${vocab} USING fts5vocab(${fts}, 'row')`);
      const n = (db.prepare(`SELECT COUNT(*) c FROM ${vocab}`).get() as { c: number }).c;
      console.log(`  ${vocab} -> ${n} terms`);
      created++;
    } catch (e) {
      console.warn(`  FAILED ${vocab}: ${e instanceof Error ? e.message : e}`);
      skipped++;
    }
  }

  console.log(`[migrate-vocab] done: ${created} created, ${skipped} skipped`);
  return created;
}

guardSync('vocab', main).catch(e => { console.error(e); process.exit(1); });
