/**
 * Every table that holds content must be either published or declared.
 *
 * WHY. /api/v1/sources' counts are live SQL and are never wrong; the LIST is
 * hand-written, so a table only appears if someone remembers to add it.
 * radar_items was exactly that shape until this same pass: 17 rows, genuinely
 * served by get_radar and /api/v1/radar, absent from the published inventory
 * - found by direct verification, not by this check (it's below MIN_ROWS).
 * Undercounting is the same defect as overcounting: the published number did
 * not describe the thing being served.
 *
 * Deriving the list from the schema is not possible on its own. Of ~30
 * tables, most are logs, join tables, FTS shadows or internal indexes, and
 * no property of the schema separates "browsable knowledge" from "our own
 * telemetry". That judgement has to be written down. This check makes
 * writing it down mandatory: a table with rows is either in the published
 * inventory or in NOT_A_SOURCE with a stated reason, and anything else fails.
 *
 * Same shape as check-scheduled's MANUAL map, for the same reason: the
 * failure mode is not a wrong answer, it is silence.
 *
 *   npx tsx scripts/check-sources.ts
 *   BASE_URL=http://127.0.0.1:3131 npx tsx scripts/check-sources.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../lib/db';
import { logRun, guardSync } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3131';

/** Below this a table is too small to change any published total materially. */
const MIN_ROWS = 25;

/**
 * Tables that hold rows and are deliberately not a knowledge source.
 * The reason is the point: it is what the next person reads instead of
 * guessing.
 */
const NOT_A_SOURCE: Record<string, string> = {
  // Our own telemetry. Counting our logs as knowledge would be counting the
  // thermometer as weather.
  sync_log: 'our own sync telemetry',
  mcp_calls: 'our own MCP call log',
  search_log: 'our own search log',
  csp_violation_log: 'our own CSP report log',
  contact_submissions: 'contact-form audit log',
  cip_alert_sent: 'de-duplication ledger for outbound Discord alerts',
  failure_events: 'our own failure log (failed syncs, degraded fallbacks, rejected calls) that check-failures pages from',
  alert_state: 'paging state of check-failures: what is open, which messages were sent, the last digest day',

  // Internal indexes / bookkeeping over sources already counted.
  embedding_doc_hash: 'change-detection hashes for the embedding index',
  // Declared before it can trip this check rather than after: it will hold
  // rows the first time prune-logs.ts finds something to take, and an
  // undeclared-table finding that's really bookkeeping is noise.
  log_rollup: 'aggregates of log rows already deleted by prune-logs.ts; the counters they feed are published, the table is not',

  // Rows that belong to a source already counted, and would double-count it.
  forum_posts: 'post bodies inside forum_topics, which is the browsable unit',
  cip_status_history: 'status transitions of cips, already counted',
  categories: 'forum category metadata, not a standalone content source',

  // Time series, not documents. Served through its own endpoint
  // (sync-network-stats.ts / lib/onchain.ts), but a snapshot every 6h is a
  // measurement, not a record someone wrote.
  network_stats: 'content-growth metric snapshots (time series, not documents)',
};

interface PublishedSource { type: string; count: number }

async function published(): Promise<PublishedSource[] | null> {
  try {
    const res = await fetch(`${BASE}/api/v1/sources`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const body = await res.json() as { sources?: PublishedSource[] };
    return body.sources ?? null;
  } catch {
    return null;
  }
}

/**
 * The table each published source counts. Read from the server's own SQL
 * rather than repeated here: a second copy of the mapping is a second thing
 * to keep in step, which is the bug this check exists for.
 */
function tablesBehindPublishedSources(): Set<string> {
  const src = fs.readFileSync(path.join(ROOT, 'mcp-server.ts'), 'utf-8');
  const start = src.indexOf('const allSources = [');
  if (start < 0) throw new Error('check-sources: could not find the sources array in mcp-server.ts');
  const end = src.indexOf('\n  ];', start);
  const block = src.slice(start, end);
  const tables = new Set([...block.matchAll(/FROM\s+(\w+)/g)].map(m => m[1]));
  // embedding_chunk is pushed onto `sources` right after the array literal,
  // not inside it, so the regex above can't see it - it's still a real
  // published tile.
  tables.add('embedding_chunks');
  return tables;
}

async function main(): Promise<void> {
  const db = getDb();
  const live = await published();

  const counted = tablesBehindPublishedSources();
  const tables = (db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table'
      AND name NOT LIKE 'sqlite_%'
      AND name NOT LIKE '%_fts%'
      AND name NOT LIKE 'embedding_vectors%'
  `).all() as Array<{ name: string }>).map(r => r.name);

  const undeclared: string[] = [];
  for (const t of tables) {
    let rows = 0;
    try { rows = (db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get() as { c: number }).c; } catch { continue; }
    if (rows < MIN_ROWS) continue;
    if (counted.has(t)) continue;
    if (t in NOT_A_SOURCE) continue;
    undeclared.push(`${t} (${rows} rows)`);
  }

  // A declaration for a table that no longer exists is stale bookkeeping,
  // and stale bookkeeping is how the list rotted in the first place.
  const existing = new Set(tables);
  const staleDeclarations = Object.keys(NOT_A_SOURCE).filter(t => !existing.has(t));

  const publishedTotal = live?.filter(s => s.type !== 'embedding_chunk').reduce((s, r) => s + r.count, 0) ?? -1;

  console.log(
    `[check-sources] ${tables.length} tables, ${counted.size} behind published sources, ` +
    `${Object.keys(NOT_A_SOURCE).length} declared not-a-source, ${undeclared.length} undeclared` +
    (publishedTotal >= 0 ? `, ${publishedTotal} records published` : ', server unreachable so the published total was not read'),
  );
  for (const u of undeclared) {
    console.error(`  UNDECLARED  ${u} — add it to the sources array in mcp-server.ts, or to NOT_A_SOURCE here with a reason`);
  }
  for (const s of staleDeclarations) console.error(`  STALE       NOT_A_SOURCE names ${s}, which no longer exists`);
  if (!live) console.error('  UNVERIFIED  /api/v1/sources did not answer, so the published inventory was not compared');

  const problems = undeclared.length + staleDeclarations.length;
  logRun('check-sources', { status: problems || !live ? 'error' : 'success', items: tables.length });

  if (problems) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  guardSync('check-sources', main).catch(e => { console.error(e); process.exitCode = 1; });
}
