/**
 * Drops the tables the pedia-template engine created for its first site
 * (CIPs, whitepapers, the foundation knowledge base, weekly digests,
 * trending snapshots) and that no NEARpedia code creates or reads. A
 * database copied from that engine still holds them, empty, and
 * check-db-rows then compares lib/db-rows.ts with tables nothing uses.
 *
 * Refuses, and drops nothing, if any of them holds a row.
 *
 *   npx tsx scripts/drop-template-tables.ts            # list what would go
 *   npx tsx scripts/drop-template-tables.ts --apply
 */

import { getDb } from '../lib/db';
import { isEntrypoint } from '../lib/is-entrypoint';

export const TEMPLATE_TABLES = ['cips', 'cip_attachments', 'cip_status_history', 'cip_alert_sent', 'foundation_kb', 'whitepapers', 'weekly_digests', 'trending_snapshot'];
const FTS = new Set(['cips', 'cip_attachments', 'foundation_kb', 'whitepapers']);

function main(): void {
  const db = getDb();
  const exists = (t: string) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  const present = TEMPLATE_TABLES.filter(exists);
  const full = present.filter((t) => (db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get() as { c: number }).c > 0);
  if (full.length) {
    console.error(`[drop-template-tables] refusing: these hold rows: ${full.join(', ')}`);
    process.exit(1);
  }
  const fts = [...FTS].map((t) => `${t}_fts`).filter(exists);
  console.log(`[drop-template-tables] empty template tables: ${present.join(', ') || 'none'}; their FTS indexes: ${fts.join(', ') || 'none'}`);
  if (!process.argv.includes('--apply') || !present.length) return;
  db.transaction(() => {
    for (const t of fts) db.exec(`DROP TABLE "${t}"`);
    for (const t of present) db.exec(`DROP TABLE "${t}"`);
  })();
  console.log(`[drop-template-tables] dropped ${fts.length + present.length} table(s)`);
}

if (isEntrypoint(import.meta.url)) main();
