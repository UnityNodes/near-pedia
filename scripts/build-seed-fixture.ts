/**
 * Write scripts/fixtures/near-seed.json from a database the live syncs
 * filled (sync-docs, sync-packages, sync-repos, sync-github-releases,
 * sync-protocol are enough). Rerun it when the curated deprecations cite a
 * new source.
 *
 *   DB_PATH=/path/to/synced.db npx tsx scripts/build-seed-fixture.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../lib/db';
import { extractFixture } from '../lib/seed-db';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'near-seed.json');

const fixture = extractFixture(getDb(), new Date().toISOString());
fs.writeFileSync(OUT, `${JSON.stringify(fixture, null, 1)}\n`);
const counts = Object.entries(fixture.tables).map(([t, rows]) => `${t} ${rows?.length ?? 0}`).join(', ');
console.log(`[build-seed-fixture] ${OUT}: ${counts}, ${fs.statSync(OUT).size} bytes`);
