/**
 * Is every scheduled writer still actually succeeding?
 *
 * WHY. check-scheduled proves a writer is in a cron bucket and CAN report its
 * own failure. Nothing reads what it then reports. This has happened: four
 * writers had been returning `partial` on every run for as long as sixteen
 * days, honestly, into a column no check opened.
 *
 * WHAT IT WILL NOT DO. It does not require `success`. `partial` is a real and
 * useful state - a crawler saying it hit a genuine per-run cap is worth
 * knowing, not worth hiding. What it refuses is SILENCE: a writer that is
 * scheduled and has not completed at all inside the window its bucket
 * implies, which is how a writer dies without anyone finding out.
 *
 * `error` IS NOT A COMPLETION. Judging by MAX(ran_at) over every row
 * regardless of status means a writer that fails on every single run,
 * loudly and correctly, resets the clock each time and reads exactly like a
 * healthy one - the failure this check exists to make impossible.
 *
 * It is the sharper half of the same class as a crash. A script that dies
 * before logRun leaves NO row, which check-scheduled already catches, just
 * slowly - at ~2.5 periods, so a daily writer gets 60 hours. A script that
 * lives long enough to report its own failure was never caught at all.
 * Failing louder made it less visible.
 *
 * One transient error still costs nothing: the window is what matters, not
 * the last row. A writer that errors once and completes on the next run has
 * completed inside its tolerance and says nothing here.
 *
 * Reads sync_log only. No network, no MCP calls, no rate limit.
 *
 *   npx tsx scripts/check-writers-succeeding.ts
 */

import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { loggedSourceOf } from '../lib/logged-source';
import {
  GUARDED_TOLERANCE_HOURS, TOLERANCE_HOURS, scheduleFromTick,
} from '../lib/schedule';

/**
 * Writers whose absence from sync_log is expected, with the reason. A run
 * this never sees is not the same as a writer that died, but only if
 * somebody said so in advance.
 */
const DECLARED: Record<string, string> = {};

// The schedule, the bucket tolerances and the guarded overrides all live in
// lib/schedule.ts; loggedSourceOf lives in lib/logged-source.ts. Both are
// shared with scripts/check-sync-staleness.sh so the three consumers of
// "how often does this run, and where does it log" cannot drift into
// disagreeing answers.

/** Hours between an ISO timestamp and now. */
function age(iso: string): number {
  return (Date.now() - Date.parse(iso)) / 3_600_000;
}

function main(): void {
  const db = getDb();
  const scheduled = scheduleFromTick();

  const silent: string[] = [];
  const unknownBucket: string[] = [];
  const unloggable: string[] = [];
  let checked = 0;
  let declared = 0;

  // LIKE, so a writer that logs one row per group is covered by the same
  // query as one that logs under a single fixed name. A name with no
  // wildcard in it makes LIKE behave exactly like equality.
  //
  // Two dates, not one. `completed` is what the tolerance is measured
  // against and it excludes `error`, because a run that reported failure did
  // not do the work. `any` is carried only to tell the two cases apart in
  // the message: a writer nothing has heard from needs a look at cron, one
  // that answers every time and always fails needs a look at the script.
  const lastRun = db.prepare(`
    SELECT MAX(CASE WHEN status != 'error' THEN ran_at END) AS completed,
           MAX(ran_at)                                      AS any
      FROM sync_log WHERE source LIKE ?`);

  for (const [script, sched] of [...scheduled].sort((a, b) => a[0].localeCompare(b[0]))) {
    const bucket = sched.bucket;
    if (script === 'check-writers-succeeding') continue; // check-sync-staleness watches this one; a run cannot report its own success before it ends
    if (DECLARED[script]) { declared++; continue; }

    let tolerance = TOLERANCE_HOURS[bucket];
    if (sched.guard) {
      const declared = GUARDED_TOLERANCE_HOURS[script];
      if (declared === undefined) {
        unknownBucket.push(
          `${script} runs in bucket "${bucket}" but behind \`${sched.guard}\`, so its cadence is not its bucket's. `
          + 'Declare its real tolerance in GUARDED_TOLERANCE_HOURS.',
        );
        continue;
      }
      tolerance = declared;
    }
    if (tolerance === undefined) {
      unknownBucket.push(`${script} runs in bucket "${bucket}", which has no tolerance declared here`);
      continue;
    }

    const source = loggedSourceOf(script);
    if (!source) {
      unloggable.push(`${script} (${bucket}) calls no logRun, so nothing can tell whether it still runs`);
      continue;
    }

    checked++;
    const row = lastRun.get(source) as { completed: string | null; any: string | null } | undefined;
    const completed = row?.completed ?? null;
    const any = row?.any ?? null;
    if (!completed) {
      silent.push(
        any
          ? `${script} (${bucket}) logs as "${source}" and every row it has ever written is an error; the newest is ${age(any).toFixed(0)}h old`
          : `${script} (${bucket}) logs as "${source}" and that source has never appeared in sync_log`,
      );
      continue;
    }
    const hoursAgo = age(completed);
    if (hoursAgo > tolerance) {
      // Naming the error run matters. Both cases are over tolerance and they
      // point at different things: nothing at all means the bucket never
      // reached the script, while a fresh error means it ran and failed,
      // which is the case that used to be invisible here.
      const erroringSince = any && Date.parse(any) > Date.parse(completed)
        ? `, though it has logged an error as recently as ${age(any).toFixed(0)}h ago`
        : '';
      silent.push(
        `${script} (${bucket}) last completed ${hoursAgo.toFixed(0)}h ago, over its ${tolerance}h tolerance${erroringSince}`,
      );
    }
  }

  console.log(
    `[check-writers-succeeding] ${checked} scheduled writer(s) checked, ${declared} declared, ` +
    `${silent.length} silent, ${unloggable.length} unloggable, ${unknownBucket.length} in an unrecognised bucket`,
  );
  for (const s of silent) console.error(`  SILENT      ${s}`);
  for (const u of unloggable) console.error(`  UNLOGGABLE  ${u}`);
  for (const u of unknownBucket) console.error(`  NO RULE     ${u}`);

  const failures = silent.length + unloggable.length + unknownBucket.length;
  logRun('check-writers-succeeding', {
    status: failures ? 'error' : 'success',
    items: checked,
    error: [...silent, ...unloggable, ...unknownBucket].join(' ; ').slice(0, 1000) || undefined,
  }, db);

  if (failures) process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error('check-writers-succeeding failed:', err);
  logRun('check-writers-succeeding', { status: 'error', error: String(err).slice(0, 500) });
  process.exit(1);
}
