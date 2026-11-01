/**
 * Rebuild the deprecations table from the curated seeds and what the syncs
 * stored. Runs after the syncs it reads (docs, packages, repos, releases).
 * A curated entry none of whose evidence still holds is reported as stale
 * and the run logs partial, so a quote that left its source is looked at
 * rather than served as current.
 *
 *   npx tsx scripts/build-deprecations.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDb } from '../lib/db';
import { guardSync, logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { buildEntries, emptySources, writeEntries } from '../lib/deprecation-engine';

async function main(): Promise<void> {
  const db = getDb();
  const now = new Date();
  // Built over a database whose syncs have not run, nine of the fifteen
  // seeds lose their evidence at once and a good table would be replaced by
  // a page of "unverified". Refuse instead and keep the last build.
  const empty = emptySources(db);
  if (empty.length) {
    logRun('deprecations', { status: 'error', items: 0, error: `source tables empty: ${empty.join(', ')}; previous build kept` }, db);
    console.error(`[build-deprecations] refusing to build: ${empty.join(', ')} empty; previous build kept`);
    process.exitCode = 1;
    return;
  }
  const entries = buildEntries(db, now);
  const unverified = entries.flatMap((e) => e.evidence.filter((v) => v.verified === false).map((v) => `${e.id}: "${(v.quote ?? '').slice(0, 60)}" not found at ${v.source_url}`));
  const result = writeEntries(db, entries, now.toISOString());

  const problems = [
    ...result.stale.map((id) => `${id}: no supporting evidence holds`),
    ...unverified,
  ];
  const byStatus = entries.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.status]: (acc[e.status] ?? 0) + 1 }), {});
  logRun('deprecations', {
    status: entries.length === 0 ? 'error' : problems.length ? 'partial' : 'success',
    items: entries.length,
    error: problems.length ? problems.join(' ; ').slice(0, 1000) : undefined,
  }, db);
  console.log(`[build-deprecations] ${entries.length} entries ${JSON.stringify(byStatus)}, ${result.added} new since the last build${problems.length ? `; ${problems.length} problems` : ''}`);
  for (const p of problems) console.warn(`  ${p}`);
  if (entries.length === 0) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  guardSync('deprecations', main).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
