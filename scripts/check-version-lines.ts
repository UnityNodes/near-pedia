/**
 * "Latest stable" leads with the current major line, not the newest by date.
 *
 * THE CLASS: a repo
 * can have released more than one major line over its history, and picking
 * "the latest stable release" by DATE instead of by LINE answers with
 * whichever release happened to publish most recently - which is only ever
 * correct if that release also belongs to the highest line. Two lines
 * publishing near the same time (an LTS still taking backports alongside a
 * new major) is exactly the case this stops being true.
 *
 * THE SURFACE. This app has one concept - "the latest release of a repo" - served
 * by one tool (get_latest_release) for every repo in github_releases, so the
 * repo list here is read from the table itself rather than hand-declared:
 * a repo added to sync-github-releases.ts's REPOS is inside this check's
 * surface the day it is first synced.
 *
 * TWO SIDES, TWO SOURCES. get_latest_release used to pick
 * `majorOf(stable[0].tag)` - the newest STABLE-TAGGED release by date, not
 * the highest line.
 * Fixed to call latestStableByLine() from lib/yourchain-versions.ts instead.
 * Asserting that fixed function against itself would only prove it agrees
 * with itself, so this calls the LIVE served tool over HTTP and compares its
 * answer to latestStableByLine() computed independently here - a future edit
 * that reverts get_latest_release to an inline date-only pick (or any other
 * drift between the two) is what this is built to catch.
 *
 * Needs the MCP server. If it is unreachable the run is UNVERIFIED, never a
 * pass.
 *
 *   npx tsx scripts/check-version-lines.ts
 */

import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { latestStableByLine, type ReleaseRow } from '../lib/yourchain-versions';

const BASE = process.env.MCP_URL ?? 'http://127.0.0.1:3131/mcp';

async function callTool(name: string, args: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    for (const line of (await res.text()).split('\n')) {
      const l = line.startsWith('data: ') ? line.slice(6) : line;
      if (!l.trim().startsWith('{')) continue;
      const parsed = JSON.parse(l) as { result?: { content?: { text?: string }[]; isError?: boolean } };
      if (parsed.result?.isError) return null;
      return parsed.result?.content?.[0]?.text ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** The version in get_latest_release's own header: "# repo tag — name". */
function servedVersion(text: string): string | null {
  const m = /^#\s+\S+\s+v?(\S+)/.exec(text);
  return m ? m[1].replace(/^v/, '') : null;
}

async function main(): Promise<void> {
  const db = getDb();
  const repos = (db.prepare('SELECT DISTINCT repo FROM github_releases').all() as { repo: string }[]).map((r) => r.repo);
  const problems: string[] = [];
  const unverified: string[] = [];
  let asserted = 0;

  for (const repo of repos) {
    const rows = db
      .prepare('SELECT tag, name, published_at, url, repo, prerelease FROM github_releases WHERE repo=? ORDER BY published_at DESC')
      .all(repo) as ReleaseRow[];
    if (!rows.length) continue;
    const lines = latestStableByLine(rows);
    if (lines.length <= 1) continue; // one line: cannot lead with a stale line
    asserted++;

    const text = await callTool('get_latest_release', { package: repo });
    if (text === null) { unverified.push(`${repo}: get_latest_release did not answer`); continue; }
    const served = servedVersion(text);
    if (served !== lines[0].latest.version) {
      problems.push(
        `${repo}: get_latest_release serves "${served ?? '(unparsed)'}" but the current major line is `
        + `${lines[0].line}.x (${lines[0].latest.version}) - a lower line served instead`,
      );
    }
  }

  for (const p of problems) console.error(`  ${p}`);
  for (const u of unverified) console.error(`  UNVERIFIED  ${u}`);

  const failures = problems.length + unverified.length;
  logRun('version-lines', {
    status: failures ? 'partial' : 'success',
    items: asserted,
    error: failures ? [...problems, ...unverified].slice(0, 3).join(' | ').slice(0, 900) : undefined,
  }, db);

  console.log(
    problems.length
      ? `[check-version-lines] ${problems.length} multi-line repo(s) serve a stale major line`
      : `[check-version-lines] ${asserted} multi-line repo(s): each serves the current major line (${unverified.length} unverified)`,
  );
  if (failures) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  main().catch(e => {
    console.error(e);
    try { logRun('version-lines', { status: 'error', items: 0, error: String(e).slice(0, 1000) }, getDb()); } catch { /* db down */ }
    process.exitCode = 1;
  });
}
