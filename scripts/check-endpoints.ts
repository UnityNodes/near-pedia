/**
 * Call every documented REST endpoint and refuse to accept a 500.
 *
 * WHY, when check-sql.ts already exists. That check compiles SQL LITERALS.
 * It cannot see a statement assembled at runtime - `conds.push('category
 * LIKE ?')` - or a query inside a file outside its search path. Calling the
 * endpoint can: the request either works or it doesn't, regardless of how
 * the query behind it was built.
 *
 * It is deliberately dumb: a 500 is always wrong, a 400 on a bad argument is
 * correct behaviour, and a 404 on a sample id that does not exist is fine
 * too. It asserts the one thing that is never acceptable.
 *
 * A 429 is neither a pass nor a failure. mcp-server.ts rate-limits its REST
 * API; hammering it in a burst and then reporting "0 returning 5xx" for
 * endpoints the check never actually reached would be exactly the kind of
 * check that lies by not looking. Any 429 is counted UNVERIFIED and keeps
 * the run from reporting clean.
 *
 *   npx tsx scripts/check-endpoints.ts
 *   BASE_URL=http://127.0.0.1:3131 npx tsx scripts/check-endpoints.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ENDPOINTS } from '../lib/api-endpoints';
import { getDb } from '../lib/db';
import { logRun, guardSync } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';

// The REST API is served by the MCP process on :3131, not the Next.js app
// on :3130 - curl localhost:3130/api/v1/... 404s, that's not a bug.
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3131';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Delay between calls so a full run doesn't trip mcp-server.ts's own rate
 * limiter and turn itself into the 429 case this check has to treat as
 * unverified.
 */
const PACE_MS = Number(process.env.CHECK_PACE_MS ?? 1_500);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * A value for each documented parameter, so filters are actually exercised.
 *
 * The class of bug this check exists for only appears when the parameter is
 * PRESENT; calling the bare path returns 200 and proves nothing. Values are
 * chosen to match real data where the filter is an enum or a foreign key.
 */
const SAMPLE: Record<string, string> = {
  limit: '2',
  offset: '0',
  days: '7',
  page: '1',
  q: 'near',
  query: 'near',
  category: 'General',
  status: 'Final',
  type: 'Standards Track',
  source: 'docs',
  repo: 'near/nearcore',
  channel: '',
  environment: 'mainnet',
  level: 'critical',
  tag: 'blog',
  author: '',
  state: 'open',
  window: '30',
  has_transcript: 'true',
  since: '',
};

/** `:id` style segments, filled from the database so the row exists. */
function sampleId(reqPath: string, db: ReturnType<typeof getDb>): string | null {
  const pick = (sql: string): string | null => {
    try { return String((db.prepare(sql).get() as { v: unknown } | undefined)?.v ?? '') || null; }
    catch { return null; }
  };
  if (reqPath.includes('/docs/')) return pick(`SELECT id v FROM doc_pages LIMIT 1`);
  if (reqPath.includes('/discussions/')) return pick(`SELECT id v FROM forum_topics LIMIT 1`);
  if (reqPath.includes('/videos/')) return pick(`SELECT id v FROM youtube_videos LIMIT 1`);
  if (reqPath.includes('/github-discussions/')) return pick(`SELECT id v FROM github_discussions LIMIT 1`);
  return '1';
}

/**
 * Routes that exist in the server but not in the published registry.
 *
 * lib/api-endpoints.ts is hand-maintained; a route added straight to
 * mcp-server.ts and never added there is live but undiscoverable through
 * /for-ai, the OpenAPI spec, or this check's own list. This catches that gap
 * mechanically instead of relying on someone remembering to update the array.
 */
function undocumentedRoutes(): string[] {
  const src = fs.readFileSync(path.join(ROOT, 'mcp-server.ts'), 'utf8');
  const live = new Set(
    [...src.matchAll(/app\.get\(\s*'(\/api\/v1[^']*)'/g)].map(m => m[1]),
  );
  const declared = new Set(ENDPOINTS.map(e => e.path.replace(/^[A-Z]+\s+/, '')));
  declared.add('/api/v1'); // the index route itself is plumbing, not a consumable endpoint
  return [...live].filter(r => !declared.has(r));
}

async function main(): Promise<void> {
  const db = getDb();
  const failures: { url: string; status: number; body: string }[] = [];
  const unverified: string[] = [];
  let called = 0;
  let skipped = 0;

  for (const ep of ENDPOINTS) {
    let reqPath = ep.path;

    // Some entries carry their verb ("POST /api/v1/check-code"). This check
    // is GET-only on purpose: it is a read probe, and firing POSTs at
    // production to see whether they 500 is the kind of "verification" that
    // creates the incident it was looking for. Reported as skipped, not
    // dropped.
    const verb = reqPath.match(/^([A-Z]+)\s+/);
    if (verb) {
      if (verb[1] !== 'GET') { skipped++; console.log(`  skip ${reqPath} (${verb[1]}, read-only probe)`); continue; }
      reqPath = reqPath.slice(verb[0].length);
    }

    // Fill path parameters. A path we cannot fill is skipped and counted,
    // never silently dropped: an unreported skip reads exactly like a pass.
    const idMatch = reqPath.match(/[:{]\w+\}?/);
    if (idMatch) {
      const id = sampleId(reqPath, db);
      if (!id) { skipped++; console.log(`  skip ${reqPath} (no sample row)`); continue; }
      reqPath = reqPath.replace(/[:{]\w+\}?/g, encodeURIComponent(id));
    }

    // Exercise the documented parameters, because the bare path proves
    // nothing. `ep.params` mixes real query-param names with descriptive
    // prose (e.g. "entry id, e.g. \"near-sdk-js\""); tokens that aren't in
    // SAMPLE are silently skipped rather than guessed at.
    const qs = new URLSearchParams();
    for (const raw of (ep.params ?? '').split(/[,\s]+/)) {
      const name = raw.replace(/[^\w]/g, '');
      if (name && SAMPLE[name]) qs.set(name, SAMPLE[name]);
    }
    const url = `${BASE}${reqPath}${qs.toString() ? `?${qs}` : ''}`;

    if (called > 0) await sleep(PACE_MS);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      called++;
      if (res.status === 429) {
        unverified.push(url); // not a pass - we never saw the handler
      } else if (res.status >= 500) {
        failures.push({ url, status: res.status, body: (await res.text()).slice(0, 160) });
      }
    } catch (err) {
      called++;
      failures.push({ url, status: 0, body: (err as Error).message.slice(0, 160) });
    }
  }

  const undocumented = undocumentedRoutes();

  console.log(`[check-endpoints] ${called} called, ${skipped} skipped, ${failures.length} returning 5xx, ${unverified.length} rate-limited (UNVERIFIED), ${undocumented.length} live but undeclared`);
  for (const u of unverified) console.error(`  UNVERIFIED  429 ${u}`);
  for (const f of failures) console.error(`\n  ${f.status || 'ERR'}  ${f.url}\n    ${f.body}`);
  for (const r of undocumented) console.error(`  UNDECLARED  ${r}  (add it to lib/api-endpoints.ts)`);

  const bad = failures.length || undocumented.length || unverified.length;
  logRun('check-endpoints', { status: bad ? 'error' : 'success', items: called });
  if (bad) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  guardSync('check-endpoints', main).catch(e => { console.error(e); process.exitCode = 1; });
}
