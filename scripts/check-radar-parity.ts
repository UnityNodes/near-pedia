/**
 * The Radar must not serve an expired alert as a live one, on either road, and
 * the two roads must agree on which alerts are live.
 *
 * Found before this check existed: /api/v1/radar had no expiry filter at all,
 * so it returned every radar_items row ever written. There was also no get_radar MCP
 * tool and no semantic_search render case for radar_item chunks (27 embedded
 * ones fell through with no title/url) - all built alongside this check rather
 * than left broken with a check pointed at nothing. See commit that added this
 * file for the full before/after.
 *
 * THE CLASS. The Radar's whole promise is "time-sensitive": breaking changes,
 * upgrade deadlines, required actions. An alert outlives its usefulness in two
 * different ways, and they are not the same column:
 *   - expires_at  is the hard end date. radarLiveSql() filters on it.
 *   - deadline    is the action date, and it can pass while expires_at is
 *                 still weeks out. An item live by expires_at with a deadline
 *                 in the past must still SAY the deadline has passed, via
 *                 deadlinePassed() - get_radar marks it "(CLOSED)", the REST
 *                 row carries deadline_passed.
 *
 * TWO ROADS, ONE DATASET. get_radar (MCP) and /api/v1/radar (REST) are
 * separate handlers reading radar_items. Both must exclude expired by
 * default, agree on the live count, and expose the passed-deadline signal.
 * The REST escape ?include_expired=true is the one intentional asymmetry, and
 * it must flag the expired rows it lets through rather than mixing them in
 * unmarked.
 *
 * THE ORACLE is the raw table, independently of either road: a live count
 * from radar_items with a bound now, and deadlinePassed() applied to the rows
 * each road would return. `now` is sampled once, BEFORE any call, so it is
 * never later than the server's own clock.
 *
 * Runs against a VACUUM INTO copy served by a second MCP instance (shared
 * startScratchMcp); no embeddings, so no OPENAI_API_KEY needed.
 *
 *   npx tsx scripts/check-radar-parity.ts
 *   npx tsx scripts/check-radar-parity.ts --verbose
 */

import { startScratchMcp } from '../lib/mcp-probe';
import { logRun } from '../lib/sync-log';
import { getDb } from '../lib/db';
import { deadlinePassed } from '../lib/radar';

const VERBOSE = process.argv.includes('--verbose');
const LIVE = 'expires_at IS NULL OR expires_at > ?';
const RADAR_ORDER = `ORDER BY CASE level WHEN 'critical' THEN 0 WHEN 'important' THEN 1 ELSE 2 END, published_at DESC`;

interface RadarItem { level: string; deadline: string | null; expires_at: string | null; deadline_passed?: boolean; expired?: boolean }

async function main(): Promise<void> {
  const problems: string[] = [];
  const record = (m: string) => problems.push(m);
  // Sampled once, before any call, so it is never later than the server clock.
  const now = new Date().toISOString();
  let examined = 0;

  const mcp = await startScratchMcp({ label: 'check-radar-parity' });
  try {
    const base = `http://127.0.0.1:${mcp.port}`;
    const snap = mcp.snapshot;

    const sqlAll = (snap.prepare('SELECT COUNT(*) c FROM radar_items').get() as { c: number }).c;
    const sqlLive = (snap.prepare(`SELECT COUNT(*) c FROM radar_items WHERE ${LIVE}`).get(now) as { c: number }).c;
    const sqlExpired = sqlAll - sqlLive;
    examined = sqlAll;
    if (VERBOSE) console.error(`  anchors: all=${sqlAll} live=${sqlLive} expired=${sqlExpired}`);
    if (sqlAll === 0) record('radar_items is empty; the check cannot prove a live filter works with nothing to filter');

    // ---- REST default: no expired, count parity, correct derived flags ----
    const rDefR = await fetch(`${base}/api/v1/radar`);
    const rDef = await rDefR.json() as { total: number; items: RadarItem[] };
    if (Math.abs(rDef.total - sqlLive) > 1) {
      record(`/api/v1/radar total ${rDef.total} != live count ${sqlLive} (expiry filter dropped?)`);
    }
    for (const it of rDef.items) {
      const live = it.expires_at == null || it.expires_at > now;
      if (!live) record(`/api/v1/radar default served an EXPIRED item (expires ${it.expires_at})`);
      if (it.expired !== false) record(`/api/v1/radar default item flagged expired=${it.expired}, must be false in the live feed`);
      if (it.deadline_passed !== deadlinePassed(it.deadline)) {
        record(`/api/v1/radar deadline_passed=${it.deadline_passed} disagrees with deadlinePassed("${it.deadline}")`);
      }
    }

    // ---- REST escape: include_expired surfaces AND flags the expired rows ----
    const rAllR = await fetch(`${base}/api/v1/radar?include_expired=true`);
    const rAll = await rAllR.json() as { total: number; items: RadarItem[] };
    if (rAll.total !== sqlAll) record(`/api/v1/radar?include_expired=true total ${rAll.total} != held ${sqlAll}`);
    const flaggedExpired = rAll.items.filter(i => i.expired === true).length;
    if (sqlExpired > 0 && flaggedExpired === 0) {
      record(`/api/v1/radar?include_expired=true returned ${rAll.total} rows but flagged none expired, though ${sqlExpired} are`);
    }
    for (const it of rAll.items) {
      if (it.deadline_passed !== deadlinePassed(it.deadline)) {
        record(`/api/v1/radar?include_expired deadline_passed=${it.deadline_passed} disagrees with deadlinePassed("${it.deadline}")`);
        break;
      }
    }

    // ---- MCP get_radar: same live count, and marks passed deadlines ----
    const gTxt = await mcp.callTool('get_radar', { limit: 100 });
    const gTotalM = gTxt.match(/(\d+) live alerts/);
    const gTotal = gTotalM ? parseInt(gTotalM[1], 10) : NaN;
    if (Number.isNaN(gTotal)) {
      record(`get_radar output did not state a live-alert count: ${gTxt.slice(0, 80)}`);
    } else if (Math.abs(gTotal - sqlLive) > 1) {
      record(`get_radar live count ${gTotal} != anchor ${sqlLive} (expiry filter dropped?)`);
    }
    const top = snap.prepare(`SELECT deadline FROM radar_items WHERE ${LIVE} ${RADAR_ORDER} LIMIT 100`).all(now) as { deadline: string | null }[];
    const wantClosed = top.filter(r => deadlinePassed(r.deadline)).length;
    const gotClosed = gTxt.split('(CLOSED)').length - 1;
    if (gotClosed !== wantClosed) {
      record(`get_radar marked ${gotClosed} deadline(s) "(CLOSED)" but ${wantClosed} of its rows have a passed deadline`);
    }
    if (VERBOSE) console.error(`  get_radar: total=${gTotal} closed marks=${gotClosed} (want ${wantClosed})`);
  } finally {
    mcp.close();
  }

  console.log(`[check-radar-parity] roads compared; ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  RADAR  ${p}`);

  logRun('check-radar-parity', {
    status: problems.length ? 'error' : 'success',
    items: examined,
    error: problems.join(' ; ').slice(0, 1000) || undefined,
  }, getDb());

  if (problems.length) process.exitCode = 1;
}

main().catch(err => {
  console.error(err);
  logRun('check-radar-parity', { status: 'error', items: 0, error: String(err).slice(0, 500) }, getDb());
  process.exitCode = 1;
});
