/**
 * Every lib/near-errors.ts entry still says what its docs page says: the
 * page is synced, and the entry's quote is in it. An entry whose quote is
 * gone is reported with its page, so the catalog is fixed from the docs,
 * not left answering from an older version of them.
 *
 *   npx tsx scripts/check-error-catalog.ts
 */

import { getDb } from '../lib/db';
import { guardSync, logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { KNOWN_ERRORS, normalise } from '../lib/near-errors';

function main(): void {
  const db = getDb();
  const page = db.prepare('SELECT content_text FROM doc_pages WHERE url = ?');
  const problems: string[] = [];
  for (const e of KNOWN_ERRORS) {
    const row = page.get(e.source_url) as { content_text: string | null } | undefined;
    if (!row?.content_text) problems.push(`${e.id}: ${e.source_url} is not in doc_pages`);
    else if (!normalise(row.content_text).includes(normalise(e.quote))) problems.push(`${e.id}: quote no longer on ${e.source_url}`);
  }
  for (const p of problems) console.error(`  FAIL  ${p}`);
  console.log(`[check-error-catalog] ${KNOWN_ERRORS.length} entries, ${problems.length} problem(s)`);
  logRun('check-error-catalog', problems.length ? { status: 'error', items: KNOWN_ERRORS.length, error: problems.slice(0, 5).join(' ; ') } : { status: 'success', items: KNOWN_ERRORS.length }, db);
  if (problems.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  guardSync('check-error-catalog', main).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
