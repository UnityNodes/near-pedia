/**
 * No radar alert outlives what it is about.
 *
 * Three assertions over radar_items, against the state the syncs hold now:
 *
 *   every row has an expires_at   an alert with no end date is the shape
 *                                 the template radar shipped, and it served
 *                                 a closed vote for weeks
 *   every live row is still true  lib/near-radar.ts recomputes the current
 *                                 set; a live row outside it is a resolved
 *                                 upgrade, a closed vote or a draft gone on
 *                                 chain that refresh-radar failed to retire
 *   no live row ends far out      an expiry over MAX_HORIZON_DAYS away is a
 *                                 unit slip, not a plan; curated events are
 *                                 dated by hand and may lie further out
 *
 * Runs right after refresh-radar in the same bucket, so a row the state
 * resolved between the two is the only race, and it is a few seconds wide.
 *
 *   npx tsx scripts/check-radar-expiry.ts
 */

import { getDb } from '../lib/db';
import { guardSync, logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { radarLiveSql } from '../lib/constants';
import { RADAR_SOURCE_TYPES, collectRadar } from '../lib/near-radar';

const MAX_HORIZON_DAYS = 120;

interface Row { id: number; source_type: string; source_id: string; title: string; expires_at: string | null }

export function radarExpiryProblems(rows: readonly Row[], live: readonly Row[], current: ReadonlySet<string>, now: Date): string[] {
  const problems: string[] = [];
  for (const r of rows) if (!r.expires_at) problems.push(`no expiry: #${r.id} ${r.source_type}:${r.source_id} ${r.title}`);
  const horizon = now.getTime() + MAX_HORIZON_DAYS * 86_400_000;
  for (const r of live) {
    if (!current.has(`${r.source_type}\u0000${r.source_id}`)) problems.push(`live but no longer true: #${r.id} ${r.source_type}:${r.source_id} ${r.title} (expires ${r.expires_at})`);
    if (r.source_type !== 'event' && r.expires_at && Date.parse(r.expires_at) > horizon) problems.push(`expires over ${MAX_HORIZON_DAYS} days out: #${r.id} ${r.source_type}:${r.source_id} (${r.expires_at})`);
  }
  return problems;
}

function main(): void {
  const db = getDb();
  const now = new Date();
  const rows = db.prepare('SELECT id, source_type, source_id, title, expires_at FROM radar_items').all() as Row[];
  const live = db.prepare(`SELECT id, source_type, source_id, title, expires_at FROM radar_items WHERE ${radarLiveSql()}`).all() as Row[];
  const { items, read } = collectRadar(db, now);
  const current = new Set(items.map((c) => `${c.sourceType}\u0000${c.sourceId}`));
  const produced: ReadonlySet<string> = new Set(RADAR_SOURCE_TYPES);
  const judged = live.filter((r) => !produced.has(r.source_type) || read.has(r.source_type as (typeof RADAR_SOURCE_TYPES)[number]));
  const problems = radarExpiryProblems(rows, judged, current, now);
  for (const p of problems) console.error(`  FAIL  ${p}`);
  console.log(`[check-radar-expiry] ${rows.length} rows, ${live.length} live, ${current.size} true now, ${problems.length} problem(s)`);
  logRun('check-radar-expiry', problems.length ? { status: 'error', items: live.length, error: problems.slice(0, 5).join(' ; ') } : { status: 'success', items: live.length }, db);
  if (problems.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  guardSync('check-radar-expiry', main).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
