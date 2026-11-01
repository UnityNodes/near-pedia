/**
 * Does every source we publish actually reach every layer that makes it usable?
 *
 * THE CLASS. Adding a source touches a dozen places: a sync script, a cron
 * bucket, the published inventory, the embedding loader, a tool that serves
 * it. Each layer can be individually correct while nothing checks whether the
 * registrations AGREE with each other. They cannot, individually: the
 * embedding loader defines both what it embeds and what it is expected to
 * embed, so a source that never enters that list is outside its own question
 * by construction - a denominator taken from the thing being measured.
 *
 * THE TWO LISTS DO NOT SHARE A VOCABULARY. /api/v1/sources says `doc`; the
 * embedding index says `doc_page`. Comparing them naively reports a healthy
 * source as missing, which is how a mapping written on the fly turns a real
 * finding into noise. The mapping is declared in lib/index-coverage.ts and
 * asserted here in both directions, so an entry that stops describing
 * anything is a failure rather than a comment.
 *
 * BOTH DIRECTIONS MATTER. A published source with no index entry is
 * unreachable by meaning. An indexed source in no inventory is the reverse:
 * nearpedia answers from it and tells nobody it holds it.
 *
 * Reads mcp-server.ts and the database. No network, no MCP calls, no rate limit.
 *
 *   npx tsx scripts/check-source-layers.ts
 */

import fs from 'node:fs';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { repoPath } from '../lib/repo-root';
import { INDEXED_SOURCES, NOT_INDEXED, PUBLISHED_TO_INDEXED } from '../lib/index-coverage';

/**
 * The source types /api/v1/sources publishes, read from the array that builds
 * it.
 *
 * From the source rather than over HTTP on purpose: this must fail when the
 * repository is wrong, not only when the running build is. A deploy that has
 * not happened yet would otherwise hide a source added an hour ago.
 */
function publishedTypes(): string[] {
  const src = fs.readFileSync(repoPath('mcp-server.ts'), 'utf-8');
  const start = src.indexOf('const allSources = [');
  if (start < 0) throw new Error('the published sources array is not where this check looks for it');
  const end = src.indexOf('\n  ];', start);
  if (end < 0) throw new Error('the published sources array does not end where this check expects');
  const block = src.slice(start, end);
  const types = [...block.matchAll(/^\s*\{\s*type:\s*'([a-z_]+)'/gm)].map(m => m[1]);
  if (types.length < 8) throw new Error(`only ${types.length} published source(s) parsed; the array shape has changed`);
  return types;
}

function main(): void {
  const db = getDb();
  const problems: string[] = [];

  const published = publishedTypes();
  const indexedTypes = new Set(INDEXED_SOURCES.map(s => s.type));

  // Forward: everything the inventory offers must be reachable by meaning, or
  // say why not.
  let reachable = 0;
  for (const p of published) {
    if (p in NOT_INDEXED) continue;
    const indexed = PUBLISHED_TO_INDEXED[p] ?? p;
    if (!indexedTypes.has(indexed)) {
      problems.push(
        `${p} is published as a source and is in no embedding loader entry`
        + (PUBLISHED_TO_INDEXED[p] ? ` (mapped to "${indexed}")` : '')
        + ' — index it, or declare it in NOT_INDEXED with the reason',
      );
      continue;
    }
    // Declared and mapped is not the same as present. A loader entry whose
    // filter never matches leaves the source published, declared, and empty.
    const chunks = (db.prepare(
      'SELECT COUNT(*) c FROM embedding_chunks WHERE source_type = ?',
    ).get(indexed) as { c: number }).c;
    if (chunks === 0) {
      problems.push(`${p} is published and has a loader entry as "${indexed}", but the index holds zero chunks for it`);
      continue;
    }
    reachable++;
  }

  // Reverse: anything answering questions must be something we admit to holding.
  const publishedSet = new Set(published);
  for (const s of INDEXED_SOURCES) {
    const back = Object.entries(PUBLISHED_TO_INDEXED).find(([, v]) => v === s.type)?.[0];
    if (publishedSet.has(back ?? s.type)) continue;
    problems.push(`${s.type} is embedded and answers questions, and appears in no published inventory`);
  }

  // A mapping entry that describes nothing is a comment pretending to be a rule,
  // and the day it stops matching is the day the comparison quietly changes.
  for (const [pub, idx] of Object.entries(PUBLISHED_TO_INDEXED)) {
    if (!publishedSet.has(pub)) problems.push(`PUBLISHED_TO_INDEXED maps "${pub}", which nothing publishes`);
    else if (!indexedTypes.has(idx)) problems.push(`PUBLISHED_TO_INDEXED maps "${pub}" to "${idx}", which no loader entry produces`);
  }
  for (const pub of Object.keys(NOT_INDEXED)) {
    if (!publishedSet.has(pub)) problems.push(`NOT_INDEXED excuses "${pub}", which nothing publishes`);
  }

  console.log(
    `[check-source-layers] ${published.length} published source(s): ${reachable} reachable by meaning, `
    + `${Object.keys(NOT_INDEXED).length} declared not indexed, ${INDEXED_SOURCES.length} loader entries`,
  );
  for (const p of problems) console.error(`  LAYER  ${p}`);

  logRun('check-source-layers', {
    status: problems.length ? 'error' : 'success',
    items: published.length,
    error: problems.join(' ; ').slice(0, 1000) || undefined,
  }, db);

  if (problems.length) process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error('check-source-layers failed:', err);
  logRun('check-source-layers', { status: 'error', error: String(err).slice(0, 500) });
  process.exit(1);
}
