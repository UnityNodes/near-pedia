/**
 * File a sync_log row for a script that died before it could file one itself.
 *
 * WHY. deploy/sync-tick.sh wraps every script in `run`, which captures the exit
 * code. A script that dies before reaching logRun leaves no row at all, so the
 * newest row it has is its last SUCCESS and every reader of sync_log (the
 * dashboards, /api/metrics, check-oracles) shows it green.
 *
 * That is how check-deployed and check-oracles wrote nothing for 17 nights and
 * check-inputs failed silently: cron runs as root, the .git directory belongs to
 * claude, and root's git refuses the repository outright. All three shell out to
 * git and died on the first call. The cause was in a text file and nowhere in the
 * database.
 *
 * WHAT THIS DOES NOT DO. It does not make the failure detected any sooner.
 * check-writers-succeeding measures against the newest COMPLETION, and an error
 * is not one. What this adds is the reason: the row carries the exit code and
 * the head of what the script printed.
 *
 * BEST EFFORT, ALWAYS. It is invoked from the failure path of a cron wrapper, so
 * it must never turn one script's failure into the bucket's. Every error here is
 * swallowed.
 *
 *   npx tsx scripts/alert-crash.ts <script> <exit-code> [since-iso] [log-tail]
 */

import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { loggedSourceOf } from '../lib/logged-source';

function main(): void {
  const [script, codeArg, since, tail] = process.argv.slice(2);
  if (!script) return;

  const source = loggedSourceOf(script);
  // A script that registers no name has nowhere to be filed. check-scheduled
  // already reports that as UNLOGGABLE, and inventing a name here would put the
  // row somewhere no check looks.
  if (!source) {
    console.error(`[alert-crash] ${script} registers no sync_log source; nothing to file`);
    return;
  }
  // A prefix name means the script writes one row per item. Which item it got to
  // before dying is not knowable from here, and a row under the literal prefix
  // would match the check's LIKE and silence it.
  if (source.endsWith('%')) {
    console.error(`[alert-crash] ${script} logs per item as "${source}"; a crash cannot be attributed to one`);
    return;
  }

  const db = getDb();

  // The script may have reported its own failure and THEN exited non-zero, which
  // is the correct shape and needs no help. Filing a second row would be honest
  // but noisy, and it would overwrite a specific diagnosis with a generic one.
  if (since) {
    const own = db.prepare(
      'SELECT 1 FROM sync_log WHERE source = ? AND ran_at >= ? LIMIT 1',
    ).get(source, since);
    if (own) {
      console.error(`[alert-crash] ${script} filed its own row for this run; leaving it alone`);
      return;
    }
  }

  const code = Number(codeArg) || 0;
  const why = (tail ?? '').replace(/\s+/g, ' ').trim().slice(0, 700);
  logRun(source, {
    status: 'error',
    items: 0,
    error: `died before it could report: exit ${code}${why ? `: ${why}` : ''}`,
  }, db);
  console.error(`[alert-crash] filed ${source} exit ${code}`);
}

try {
  main();
} catch (e) {
  // Deliberately quiet. A recorder that fails is worse than useless if it also
  // takes down the run it was recording.
  console.error(`[alert-crash] could not file: ${(e as Error).message}`);
}
