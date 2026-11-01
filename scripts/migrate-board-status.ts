import { getDb } from '../lib/db';
const db = getDb();
const cols = db.prepare("PRAGMA table_info(github_items)").all() as Array<{ name: string }>;
const has = cols.some(c => c.name === 'board_status');
if (!has) {
  db.prepare("ALTER TABLE github_items ADD COLUMN board_status TEXT").run();
  console.log('Added board_status column');
} else {
  console.log('board_status already exists');
}
