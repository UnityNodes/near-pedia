/**
 * How often each writer is supposed to run, and how long it may go quiet.
 *
 * WHY IT IS SHARED. An audit found yourpedia's own
 * scripts/check-sync-staleness.sh had drifted into an anti-pattern: a hand-typed table of thresholds
 * keyed by SCRIPT name, disconnected from deploy/sync-tick.sh, with a blanket
 * fallback for anything unlisted. That shape is how a source silently goes
 * unwatched or gets judged against the wrong cadence — the schedule is read
 * once, here, and the tolerance is computed once and PUBLISHED next to the
 * age it is compared with, leaving the shell watchdog with no table to get
 * wrong.
 */

import fs from 'node:fs';
import { repoPath } from './repo-root';
import { loggedSourceOf } from './logged-source';
import { stripShellComments } from './strip-comments';

/**
 * How long a writer in each bucket may go without completing before that is a
 * fact worth a human.
 *
 * Six names: five are deploy/sync-tick.sh's crontab buckets — fast every 5
 * minutes, medium every 15, slow every 6 hours, daily at 03:15, weekly
 * Mondays at 04:30 — at ~2.5 periods tolerance, deliberately many multiples
 * of the small ones, because one skipped run is a blip and this is looking
 * for a writer that STOPPED. `cf` is deploy/sync-cf.sh's own 30-minute
 * cadence (sync-forum/sync-blog, under xvfb since Cloudflare gates them) at
 * a wider ~12x multiple rather than the usual 2.5x: a real headful-browser
 * scrape through anti-bot defenses fails transiently far more often than a
 * plain fetch, and the previous hardcoded table's 12h figure for this same
 * cadence reflected that same judgment.
 */
export const TOLERANCE_HOURS: Record<string, number> = {
  fast: 3,
  medium: 6,
  slow: 36,
  daily: 60,
  weekly: 420,
  cf: 12,
};

/**
 * Writers whose `run` sits behind a shell conditional in deploy/sync-tick.sh,
 * with the real tolerance in hours. Empty today — yourpedia's buckets are
 * flat `run a; run b; ...` with no `if` guards — kept so a future guarded
 * writer has somewhere to declare its real cadence instead of inheriting a
 * bucket tolerance that doesn't describe it.
 */
export const GUARDED_TOLERANCE_HOURS: Record<string, number> = {};

export interface Scheduled { bucket: string; guard: string | null }

/**
 * Which bucket each `run <name>` (or the bare `embed` call) sits in.
 *
 * deploy/sync-tick.sh's case arms are one line each — `fast)   run
 * refresh-trending ;;` — not a label-then-indented-block shape, so this reads the whole arm body after `label)` up to
 * `;;` and pulls every `run NAME` out of it, rather than walking line by
 * line.
 */
function scheduleFromTickFile(): Map<string, Scheduled> {
  const out = new Map<string, Scheduled>();
  const text = stripShellComments(fs.readFileSync(repoPath('deploy', 'sync-tick.sh'), 'utf8'));

  for (const line of text.split('\n')) {
    const arm = line.match(/^\s*([a-z][a-z0-9|]*)\)\s+(.*);;\s*$/);
    if (!arm) continue;
    const bucket = arm[1].split('|')[0];
    // `all` is the manual "sync everything" path, not a schedule; `*` is the
    // usage-error branch.
    if (bucket === 'all' || bucket === '*') continue;
    const body = arm[2];

    for (const m of body.matchAll(/(?<![\w-])run\s+"?([a-z0-9-]+)"?/g)) {
      if (!out.has(m[1])) out.set(m[1], { bucket, guard: null });
    }
    // The bare `embed` function call (not `run embed` - there is no
    // scripts/embed.ts) runs scripts/build-embeddings.ts, which is the file
    // loggedSourceOf needs to find its sync_log registration.
    if (/(?:^|;)\s*embed\s*(?:;|$)/.test(body) && !out.has('build-embeddings')) {
      out.set('build-embeddings', { bucket, guard: null });
    }
  }
  return out;
}

/**
 * deploy/sync-cf.sh runs on its own fixed 30-minute cron entry, separate
 * from sync-tick.sh's buckets, because its sources (forum, blog) need a real
 * headful browser under xvfb to get past Cloudflare. Every `run NAME` line
 * in it belongs to the `cf` tolerance bucket.
 */
function scheduleFromCfFile(): Map<string, Scheduled> {
  const out = new Map<string, Scheduled>();
  let text: string;
  try {
    text = stripShellComments(fs.readFileSync(repoPath('deploy', 'sync-cf.sh'), 'utf8'));
  } catch {
    return out;
  }
  for (const m of text.matchAll(/(?<![\w-])run\s+"?([a-z0-9-]+)"?/g)) {
    if (!out.has(m[1])) out.set(m[1], { bucket: 'cf', guard: null });
  }
  return out;
}

/** Every writer deploy's two cron entry points (sync-tick.sh + sync-cf.sh) run, with its bucket. */
export function scheduleFromTick(): Map<string, Scheduled> {
  const out = scheduleFromTickFile();
  for (const [script, sched] of scheduleFromCfFile()) {
    if (!out.has(script)) out.set(script, sched);
  }
  return out;
}

/** How long this script may stay quiet, or null when nothing here can say. */
export function toleranceHoursFor(script: string, sched: Scheduled): number | null {
  if (sched.guard) return GUARDED_TOLERANCE_HOURS[script] ?? null;
  return TOLERANCE_HOURS[sched.bucket] ?? null;
}

/**
 * sync_log source name -> seconds it may go without completing.
 *
 * Keyed by SOURCE, because that is what sync_log records and what every
 * reader downstream is holding.
 *
 * A source absent from this map is not on a schedule — a one-off migration,
 * a backfill, a diagnostic — and has no cadence to be late against. Absent
 * must mean SKIPPED and never "use a default".
 */
export function toleranceSecondsBySource(): Map<string, number> {
  const out = new Map<string, number>();
  for (const [script, sched] of scheduleFromTick()) {
    const hours = toleranceHoursFor(script, sched);
    if (hours === null) continue;
    const source = loggedSourceOf(script);
    if (!source) continue;
    const secs = hours * 3600;
    // Two scripts writing one source keep the tighter deadline: the source is
    // late as soon as the most frequent thing that writes it is.
    const prev = out.get(source);
    if (prev === undefined || secs < prev) out.set(source, secs);
  }
  return out;
}
