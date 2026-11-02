/**
 * Assert that every writer is scheduled, and that it can report its own
 * failure.
 *
 * WHY SCHEDULED. sync_log cannot tell "ran, nothing changed" from "has not
 * run in 47 days" for a script that was never wired into a cron bucket in
 * the first place - there is no row to be stale, so the staleness watchdog
 * has nothing to alert on. The 2026-08-01 serving-layer audit found exactly
 * this shape: scripts/sync-youtube-transcripts.ts existed, worked, and
 * wasn't in deploy/sync-tick.sh or the crontab, so 463/467 videos had a
 * transcript from one manual backfill and every video added since had none,
 * silently, for weeks. This assertion would have caught it as a failing
 * check on the day the script was written rather than as a slow leak found
 * by hand.
 *
 * A script may legitimately be manual: a one-off migration, a backfill, a
 * diagnostic. Those are declared in MANUAL below with the reason, so "not
 * scheduled" always means either an entry in sync-tick.sh or an
 * explicit decision, never an oversight.
 *
 * WHY GUARDED. A script that writes sync_log must route its outcome through
 * lib/sync-log.ts, where the failure path exists by construction. Copying an
 * old script is the most likely way to write a new one, and this makes that
 * copy fail loudly if it drops the .catch() instead of quietly reporting
 * "success" for having reached the last line.
 *
 * Cadence: daily, before the other checks. Log: sync_log source='scheduling'.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { WRITER_RE } from '../lib/oracles';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Scripts that are correctly not on a schedule, each with why. */
const MANUAL: Record<string, string> = {
  'migrate-board-status': 'one-off schema migration',
  'backfill-video-dates': 'one-off backfill for videos migrated without a real published_at',
  'fix-flattened-doc-code': 'one-off repair for content_text flattened by a since-fixed cleanup-doc-html.ts bug, re-run by hand if it recurs',
  'fix-orphaned-embeddings': 'one-off prune of embedding_chunks/embedding_doc_hash rows left behind by a blog_posts id-scheme change, re-run by hand if new orphans appear',
  'backfill-blog-text': 'one-off repair of blog_posts.content_text glued by the old node-html-parser .text, re-derived offline from content_html; re-run by hand if it recurs',
  'push-radar-tg': 'not enabled here: posts to a Telegram channel and needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID, neither set on this box. Wire it into the tick when a channel exists',
  'alert-crash': "invoked by sync-tick's own run() wrapper on a non-zero exit, never on a timer; it files the sync_log row a script that died before reaching logRun could not file for itself, and a healthy box never runs it at all",
  'fix-vec': 'diagnostic/repair for the sqlite-vec index, run by hand',
  'clean-vec': 'destructive vec0 reset for a broken schema; run deliberately, not on a timer',
  'cleanup-docs': 'one-off corpus cleanup (dead redirects, near-empty pages), re-run by hand',
  'cleanup-doc-html': 'one-off HTML-artifact cleanup in doc_pages, re-run by hand',
  'build-embeddings': 'invoked directly by sync-tick.sh via the embed() helper, not through run()',
  'check-db': 'diagnostic',
  'check-tables': 'diagnostic',
  'check-rag-sources': 'diagnostic',
  'check-scheduled': 'this script; scheduled, but listed so it never asserts on itself',
  'check-sql': 'scheduled in the daily bucket alongside this one',
  'check-completeness': 'scheduled in the daily bucket alongside this one',
  'check-endpoints': 'scheduled in the daily bucket alongside this one',
};

function main(): void {
  const scriptsDir = path.join(ROOT, 'scripts');
  const tick = fs.readFileSync(path.join(ROOT, 'deploy', 'sync-tick.sh'), 'utf-8');

  const scripts = fs
    .readdirSync(scriptsDir)
    .filter(f => WRITER_RE.test(f))
    .map(f => f.replace(/\.ts$/, ''))
    .sort();

  const unscheduled: string[] = [];

  for (const name of scripts) {
    // \b, not (^|\s)...(\s|$): `run check-failures;` and the `for s in ...
    // sync-youtube; do` shell syntax both butt a name straight up
    // against a semicolon with no trailing whitespace, which a literal
    // whitespace-or-end boundary misses entirely - it reported both of
    // those as unscheduled the first time this ran against the real files.
    const scheduled = new RegExp(`\\b${name}\\b`, 'm').test(tick);
    if (scheduled) continue;
    if (name in MANUAL) continue;
    unscheduled.push(name);
  }

  console.log(`${scripts.length} writers, ${Object.keys(MANUAL).length} declared manual.`);

  const problems: string[] = [];
  if (unscheduled.length) {
    problems.push(`not in sync-tick.sh and not declared manual: ${unscheduled.join(', ')}`);
    for (const n of unscheduled) console.error(`  UNSCHEDULED  ${n}`);
  }

  // A script that writes its own sync_log row has, by doing so, opted out of
  // the one code path that knows how to record a failure. It must therefore
  // be wrapped, so the error case is covered even though the success case
  // is not.
  const unguarded: string[] = [];
  for (const name of scripts) {
    // The recorder of other scripts' crashes. It swallows its own errors on
    // purpose (a recorder that fails must not take down the run it records), so
    // "no visible failure path" is its design and not a gap.
    if (name === 'alert-crash') continue;
    const src = fs.readFileSync(path.join(scriptsDir, `${name}.ts`), 'utf-8');
    if (!/INSERT INTO sync_log|logRun\(/.test(src)) continue;
    if (/\b(guardSync|logRunOnCrash)\b/.test(src)) continue;
    // A .catch/.catch-block that calls logRun is an explicit, working
    // error path; that is the property being asserted, and there is more
    // than one way to satisfy it (see scripts/sync-github-releases.ts,
    // which logs 'error' inline via a fetchFailed flag rather than a
    // .catch).
    if (/\.catch\([\s\S]*logRun\(/.test(src)) continue;
    if (/catch\s*\([^)]*\)\s*{[\s\S]*logRun\(/.test(src)) continue;
    unguarded.push(name);
  }
  if (unguarded.length) {
    problems.push(`writes sync_log with no visible failure path: ${unguarded.join(', ')}`);
    for (const n of unguarded) console.error(`  UNGUARDED  ${n}`);
  }

  // tsconfig.json already covers scripts/ (unlike the template this was
  // forked from, where it didn't and hid a live regression - see CLAUDE.md),
  // so a plain --noEmit is the same check `npm run build`'s type pass runs.
  // Still worth asserting here: this repo has no CI, so this daily check is
  // the only thing that runs it unless someone remembers to by hand.
  try {
    execFileSync('npx', ['tsc', '--noEmit'], { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe' });
    console.log('tsc --noEmit clean.');
  } catch (err) {
    const out = String((err as { stdout?: string }).stdout ?? err).trim();
    const lines = out.split('\n').filter(l => l.includes('error TS'));
    problems.push(`tsc has ${lines.length} error(s): ${lines.slice(0, 3).join(' | ')}`);
    for (const l of lines.slice(0, 10)) console.error(`  TYPE  ${l}`);
  }

  logRun('check-scheduled', { status: problems.length ? 'error' : 'success', items: scripts.length });

  if (problems.length) {
    console.error(`\n${problems.length} problem(s).`);
    process.exitCode = 1;
  } else {
    console.log('Every writer is scheduled or explicitly manual.');
  }
}

if (isEntrypoint(import.meta.url)) main();
