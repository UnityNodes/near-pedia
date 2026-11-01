import { getDb } from './db';

export function rebuildFts(): void {
  const db = getDb();
  db.exec(`INSERT INTO cips_fts(cips_fts) VALUES('rebuild')`);
}
