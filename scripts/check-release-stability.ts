/**
 * "Latest stable" is never a release the source flagged prerelease.
 *
 * THE CLASS. A release carries two independent stability
 * signals: the tag string (v9.0.6 vs v9.0.6-testnet) and GitHub's own
 * `prerelease` boolean. Judging stability from the tag alone misses the
 * case where they disagree - and they do, on this app's own data: 4 of the
 * 806 indexed releases carry a plain-looking tag (v0.0.1, v0.14.0, v0.11.2,
 * v0.10.6) while GitHub marks them prerelease=1. None is currently a repo's
 * newest stable-tagged release, so nothing served today is wrong - but
 * "not yet triggered" is not the same as "cannot happen", which is why this
 * is asserted rather than left to be found by hand the day it does.
 *
 * WHY NO CHECK SAW IT BEFORE THIS ONE. github_releases had no `prerelease`
 * column at all until this same round added one (see lib/db.ts, sync-
 * github-releases.ts) - nothing could compare the served "latest" against a
 * flag that was never fetched into a column, even though the GitHub API
 * response has always carried it.
 *
 * WHAT THIS ASSERTS. For every repo that publishes releases, the release
 * latestStableByLine (the same function get_latest_release calls) picks as
 * a line's latest stable must have prerelease=0.
 *
 *   npx tsx scripts/check-release-stability.ts
 */

import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { latestStableByLine, type ReleaseRow } from '../lib/yourchain-versions';

function main(): void {
  const db = getDb();
  const repos = (db.prepare('SELECT DISTINCT repo FROM github_releases').all() as { repo: string }[]).map((r) => r.repo);
  const problems: string[] = [];
  let picks = 0;

  for (const repo of repos) {
    const rows = db
      .prepare('SELECT tag, name, published_at, url, repo, prerelease FROM github_releases WHERE repo=? ORDER BY published_at DESC')
      .all(repo) as ReleaseRow[];
    if (!rows.length) continue;

    for (const line of latestStableByLine(rows)) {
      picks++;
      // Map the served ReleaseRef (version = tag without a leading v) back to
      // the row it came from, to read the prerelease flag the ref does not carry.
      const pick = rows.find((r) => r.tag.replace(/^v/, '') === line.latest.version);
      if (pick && pick.prerelease) {
        problems.push(
          `${repo} line ${line.line}: "latest stable" ${line.latest.version} (${(line.latest.releasedAt ?? '').slice(0, 10)}) `
          + `is flagged prerelease=1 on GitHub - a prerelease served as the stable release`,
        );
      }
    }
  }

  for (const p of problems) console.error(`  ${p}`);

  logRun('release-stability', {
    status: problems.length ? 'error' : 'success',
    items: picks,
    error: problems.length ? problems.slice(0, 3).join(' | ').slice(0, 900) : undefined,
  }, db);

  console.log(
    problems.length
      ? `[check-release-stability] ${problems.length} line(s) serve a GitHub prerelease as the latest stable`
      : `[check-release-stability] ${picks} latest-stable pick(s) across ${repos.length} repo(s): none is a GitHub prerelease`,
  );
  if (problems.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error('[check-release-stability] failed:', err);
    try { logRun('release-stability', { status: 'error', items: 0, error: String(err).slice(0, 1000) }, getDb()); } catch { /* db down */ }
    process.exitCode = 1;
  }
}
