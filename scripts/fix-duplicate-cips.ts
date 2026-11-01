import { getDb } from '../lib/db';

const db = getDb();

const dupNumbers = [102, 106];

for (const num of dupNumbers) {
  const rows = db.prepare(
    'SELECT id, cip_number, title, synced_at FROM cips WHERE cip_number = ? ORDER BY synced_at DESC'
  ).all(num) as { id: string; cip_number: number; title: string; synced_at: string }[];

  console.log(`\nCIP ${num} duplicates:`);
  rows.forEach(r => console.log(`  id=${r.id}, title=${r.title}, synced_at=${r.synced_at}`));

  if (rows.length < 2) {
    console.log(`  Already only 1 entry, skipping.`);
    continue;
  }

  const toKeep = rows[0];
  const toDelete = rows.slice(1);

  for (const r of toDelete) {
    db.prepare('DELETE FROM cips WHERE id = ? AND cip_number = ?').run(r.id, r.cip_number);
    console.log(`  Deleted id=${r.id}`);
  }

  console.log(`  Kept id=${toKeep.id}`);
}

const remaining = db.prepare(
  'SELECT cip_number, COUNT(*) as c FROM cips WHERE cip_number IS NOT NULL GROUP BY cip_number HAVING c > 1'
).all();
console.log('\nRemaining duplicates:', remaining);

db.prepare("INSERT INTO cips_fts(cips_fts) VALUES('rebuild')").run();
console.log('FTS rebuilt');
