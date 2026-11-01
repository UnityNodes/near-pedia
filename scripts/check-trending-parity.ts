/**
 * The trending feed is one ranked list served two ways, and both must serve it
 * in rank order.
 *
 * This app's trending_snapshot / get_trending / /api/v1/trending already
 * existed, so no fix was needed to give this check a real
 * target - unlike check-radar-parity and check-index-validity, which had to
 * build the surface they now guard.
 *
 * THE SHAPE. refresh-trending scores content over a 7-day window, sorts by
 * score DESC, and stores the top N as one JSON payload in trending_snapshot.
 * get_trending (top 15) and /api/v1/trending (top 20) both read that one
 * payload and slice a prefix, so they agree by construction - as long as
 * neither re-sorts and the payload is actually sorted.
 *
 * WHAT WAS UNGUARDED. A ranking is its order: if refresh-trending's sort
 * inverted, or a road re-sorted its slice, both roads would print a count
 * that still matched and a "top" list that was the bottom, and every count-
 * based check would stay green. A ranked cut with nothing asserting the rank
 * is the same defect class as a LIMIT with no ORDER BY.
 *
 * ASSERTS:
 *   - the payload is sorted score-descending (refresh-trending's ranking held)
 *   - /api/v1/trending is the payload's top-20 prefix, in order, by (src,id,score),
 *     with total == payload length and the snapshot's updated_at
 *   - get_trending's rendered rows are the payload's top-15 prefix, in order, by
 *     (src,score), and its stated total == payload length
 *   - the two roads agree on their overlapping 15-item prefix
 *
 * Freshness is NOT re-checked here: there is one snapshot, so a stale serve is
 * a stale writer, which check-writers-succeeding already owns.
 *
 *   npx tsx scripts/check-trending-parity.ts
 *   npx tsx scripts/check-trending-parity.ts --verbose
 */

import { startScratchMcp } from '../lib/mcp-probe';
import { logRun } from '../lib/sync-log';
import { getDb } from '../lib/db';

const VERBOSE = process.argv.includes('--verbose');

interface TItem { src: string; id: string | number; title: string; path: string; score: number }

async function main(): Promise<void> {
  const problems: string[] = [];
  const record = (m: string) => problems.push(m);
  let examined = 0;

  const mcp = await startScratchMcp({ label: 'check-trending-parity' });
  try {
    const base = `http://127.0.0.1:${mcp.port}`;
    const snapRow = mcp.snapshot.prepare('SELECT payload, updated_at FROM trending_snapshot WHERE id=1').get() as { payload: string; updated_at: string } | undefined;
    if (!snapRow) {
      record('trending_snapshot id=1 is missing; both roads would 404 / say "No trending data"');
      throw new Error('no snapshot');
    }
    const payload: TItem[] = JSON.parse(snapRow.payload);
    const n = payload.length;
    examined = n;
    if (VERBOSE) console.error(`  snapshot: ${n} items, updated_at=${snapRow.updated_at}`);

    // 1. the ranking invariant: sorted score-descending.
    for (let i = 1; i < payload.length; i++) {
      if (payload[i].score > payload[i - 1].score) {
        record(`snapshot payload is not score-descending at index ${i} (${payload[i - 1].score} then ${payload[i].score}); the ranking is scrambled`);
        break;
      }
    }

    // 2. REST is the top-20 prefix, in order.
    const restRes = await fetch(`${base}/api/v1/trending`);
    const rest = await restRes.json() as { total: number; updated_at: string; items: TItem[] };
    if (rest.total !== n) record(`/api/v1/trending total ${rest.total} != payload length ${n}`);
    if (rest.updated_at !== snapRow.updated_at) record(`/api/v1/trending updated_at ${rest.updated_at} != snapshot ${snapRow.updated_at}`);
    const restExpect = payload.slice(0, 20);
    if (rest.items.length !== restExpect.length) record(`/api/v1/trending returned ${rest.items.length} items, expected top-${restExpect.length} of ${n}`);
    for (let i = 0; i < Math.min(rest.items.length, restExpect.length); i++) {
      const a = rest.items[i], b = restExpect[i];
      if (String(a.src) !== String(b.src) || String(a.id) !== String(b.id) || a.score !== b.score) {
        record(`/api/v1/trending item ${i} = [${a.src}:${a.id} score ${a.score}] != payload [${b.src}:${b.id} score ${b.score}] (order or content diverged)`);
        break;
      }
    }

    // 3. get_trending renders the top-15 prefix, in order, by (src,score).
    const txt = await mcp.callTool('get_trending', {});
    const rendered: Array<{ src: string; score: number }> = [];
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*\d+\.\s*\[([A-Z]+)\]/);
      if (m) rendered.push({ src: m[1].toLowerCase(), score: NaN });
    }
    const scores = [...txt.matchAll(/Score:\s*(-?\d+)/g)].map(x => parseInt(x[1], 10));
    rendered.forEach((r, i) => { r.score = scores[i]; });
    const mcpExpect = payload.slice(0, 15);
    if (rendered.length !== mcpExpect.length) record(`get_trending rendered ${rendered.length} rows, expected top-${mcpExpect.length} of ${n}`);
    for (let i = 0; i < Math.min(rendered.length, mcpExpect.length); i++) {
      if (rendered[i].src !== String(mcpExpect[i].src) || rendered[i].score !== mcpExpect[i].score) {
        record(`get_trending row ${i} = [${rendered[i].src} score ${rendered[i].score}] != payload [${mcpExpect[i].src} score ${mcpExpect[i].score}] (order or content diverged)`);
        break;
      }
    }
    const totalM = txt.match(/of (\d+) ranked item/);
    const glrTotal = totalM ? parseInt(totalM[1], 10) : (rendered.length === n ? n : NaN);
    if (!Number.isNaN(glrTotal) && glrTotal !== n) record(`get_trending stated total ${glrTotal} != payload length ${n}`);

    // 4. the two roads agree on their overlapping 15-prefix (by src,score).
    for (let i = 0; i < Math.min(15, rest.items.length, rendered.length); i++) {
      if (String(rest.items[i].src) !== rendered[i].src || rest.items[i].score !== rendered[i].score) {
        record(`roads disagree at rank ${i}: REST [${rest.items[i].src} ${rest.items[i].score}] vs get_trending [${rendered[i].src} ${rendered[i].score}]`);
        break;
      }
    }
  } finally {
    mcp.close();
  }

  console.log(`[check-trending-parity] both roads vs snapshot; ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  TRENDING  ${p}`);

  logRun('check-trending-parity', {
    status: problems.length ? 'error' : 'success',
    items: examined,
    error: problems.join(' ; ').slice(0, 1000) || undefined,
  }, getDb());

  if (problems.length) process.exitCode = 1;
}

main().catch(err => {
  console.error(err);
  logRun('check-trending-parity', { status: 'error', items: 0, error: String(err).slice(0, 500) }, getDb());
  process.exitCode = 1;
});
