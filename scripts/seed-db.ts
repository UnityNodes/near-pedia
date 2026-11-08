/**
 * Fill a fresh database from scripts/fixtures/near-seed.json, offline and
 * with no keys, then build the deprecation index over it. Enough for
 * check_code, check_deprecation and /protocol to answer locally; the full
 * index is npm run sync:near.
 *
 *   npm run db:seed
 *   DB_PATH=/tmp/seed.db npm run db:seed
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../lib/db';
import { readFixture, seedDatabase } from '../lib/seed-db';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'near-seed.json');

try {
  const started = Date.now();
  const fixture = readFixture(FIXTURE);
  const db = getDb();
  const out = seedDatabase(db, fixture, new Date());
  const rows = Object.entries(out.rows).map(([t, n]) => `${t} ${n}`).join(', ');
  console.log(`[db:seed] ${db.name}: ${rows}; ${out.deprecations} deprecation entries; fixture recorded ${fixture.recorded_at}; ${((Date.now() - started) / 1000).toFixed(1)} s`);
} catch (e) {
  console.error(`[db:seed] ${(e as Error).message}`);
  process.exit(1);
}
