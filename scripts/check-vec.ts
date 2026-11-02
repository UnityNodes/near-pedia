/**
 * check-vec - does the sqlite-vec WRITE path still accept our binds?
 *
 * The class this guards against: the vec0 driver's bind requirements can
 * shift under a dependency bump while every reader stays green - a rowid
 * bound as a plain JS number can work for months and then the driver starts
 * demanding BigInt, breaking every hand-rolled insert with "Only integers
 * are allowed for primary key values" while a script that only prints and
 * never asserts exits 0 regardless. build-embeddings would hit the same wall
 * on its next new chunk. This file previously WAS that unsafe shape: a fixed
 * magic rowid (99999) that sits inside nearpedia's live embedding_vectors id
 * range and only stayed safe by luck, a hardcoded dimension count instead of
 * reading the table's own definition, no read-back verification, and no
 * exit code on failure.
 *
 * The probe is one INSERT + DELETE on the LIVE embedding_vectors table, at a
 * rowid provably above anything real: chunk ids are monotonically
 * increasing, so MAX(rowid)+1,000,000 can never collide with a live vector
 * or with a concurrent build-embeddings run.
 *
 *   npx tsx scripts/check-vec.ts
 */
import { getDb } from '../lib/db';
import { logRun, logRunOnCrash } from '../lib/sync-log';
import { DIMENSIONS } from '../lib/embedding-dims';

logRunOnCrash('check-vec');

const db = getDb();

const dims = (() => {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'embedding_vectors'").get() as { sql: string } | undefined;
  const m = row?.sql.match(/float\[(\d+)\]/i);
  if (!m) {
    console.error('[check-vec] embedding_vectors table not found or not a vec0 float table');
    logRun('check-vec', { status: 'error', items: 1, error: 'embedding_vectors missing or not vec0' });
    process.exit(1);
  }
  return parseInt(m[1], 10);
})();

if (dims !== DIMENSIONS) {
  console.error(`[check-vec] embedding_vectors holds ${dims}-dim vectors, the embedder returns ${DIMENSIONS}: run clean-vec, then build-embeddings`);
  logRun('check-vec', { status: 'error', items: 1, error: `vector table is ${dims}-dim, embedder is ${DIMENSIONS}-dim` });
  process.exit(1);
}

const maxRowid = (db.prepare('SELECT MAX(rowid) AS m FROM embedding_vectors').get() as { m: number | null }).m ?? 0;
// No BigInt literal: check-scheduled type-checks scripts/ at a pre-ES2020 target.
const probe = BigInt(maxRowid) + BigInt(1_000_000);

try {
  db.prepare('INSERT INTO embedding_vectors (rowid, embedding) VALUES (?, ?)')
    .run(probe, JSON.stringify(new Array(dims).fill(0.1)));
  const held = db.prepare('SELECT COUNT(*) AS c FROM embedding_vectors WHERE rowid = ?').get(probe) as { c: number };
  db.prepare('DELETE FROM embedding_vectors WHERE rowid = ?').run(probe);
  if (held.c !== 1) {
    console.error(`[check-vec] probe insert reported success but the row was not readable back (count ${held.c})`);
    logRun('check-vec', { status: 'error', items: 1, error: `probe row not readable back (count ${held.c})` });
    process.exit(1);
  }
  console.log(`[check-vec] vec0 write path ok: ${dims}-dim insert+read+delete at probe rowid ${probe}`);
  logRun('check-vec', { status: 'success', items: 1 });
} catch (e) {
  // Best effort: never leave the probe row behind on a half-failure.
  try { db.prepare('DELETE FROM embedding_vectors WHERE rowid = ?').run(probe); } catch { /* ignore */ }
  console.error('[check-vec] vec0 write probe failed:', (e as Error).message);
  logRun('check-vec', { status: 'error', items: 1, error: (e as Error).message });
  process.exit(1);
}
