/**
 * Repository state for the NEAR GitHub organisations in lib/near-sources.ts:
 * archived or live, last push, and the deprecation notice a README opens
 * with. Archive flips and new README notices go to change_events.
 *
 * Quota. The org listings are the only API calls (about 14 pages for the
 * nine orgs on 2026-11-02). READMEs come from raw.githubusercontent.com,
 * which is outside the API rate limit, and a README is re-read only when the
 * repository was pushed since the last read, so after the first run a day
 * costs a few dozen raw fetches.
 *
 *   npx tsx scripts/sync-repos.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDb } from '../lib/db';
import { guardSync, logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { prune } from '../lib/prune';
import { SITE } from '../lib/site.config';
import { HttpError, politeFetch, politeGetText } from '../lib/polite-fetch';
import { GITHUB_ORGS } from '../lib/near-sources';
import { detectReadmeNotice, diffRepo, fromGithubRepo, readmeNoticeEvent, type RepoSnapshot } from '../lib/github-repos';
import { loadOrgRepos, saveReadme, saveRepo } from '../lib/repos-store';
import { recordEvents, type ChangeEvent } from '../lib/change-events';
import { hasNextPage } from '../lib/github-pages';

const UA = `${SITE.slug}-sync/1.0 (+${SITE.publisher.url})`;
const MAX_PAGES = 10;
/**
 * Bounds one run's wall clock; the rest are read on the next run, never-read
 * first. `--all-readmes` lifts it, for filling a fresh database in one go
 * (npm run sync:near): with the cap, a first run saw the READMEs of 400 of
 * 804 repositories and missed half the "deprecated" notices.
 */
const README_CAP = process.argv.includes('--all-readmes') ? Number.POSITIVE_INFINITY : 400;
const README_PACE_MS = 100;
const README_NAMES = ['README.md', 'readme.md', 'README.rst', 'README'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

interface OrgListing { repos: RepoSnapshot[]; complete: boolean; error?: string }

async function listOrg(org: string): Promise<OrgListing> {
  const repos: RepoSnapshot[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/orgs/${org}/repos?per_page=100&type=public&page=${page}`;
    let r;
    try {
      r = await politeFetch(url, { userAgent: UA, headers: apiHeaders(), delays: [2_000, 8_000] });
    } catch (e) {
      const remaining = e instanceof HttpError ? e.headers?.get('x-ratelimit-remaining') : null;
      return { repos, complete: false, error: `${(e as Error).message}${remaining === '0' ? ' (rate limit spent)' : ''}` };
    }
    if (r.kind === 'not-found') return { repos, complete: false, error: `org ${org} not found` };
    if (r.kind !== 'ok') return { repos, complete: false, error: `unexpected ${r.kind}` };
    try {
      const batch = (await r.res.json()) as unknown;
      if (!Array.isArray(batch)) throw new Error('listing is not an array');
      // The configured name, not the one GitHub echoes: stored rows, the diff
      // and the prune scope all key on it, and a case difference between the
      // two would make every one of them silently match nothing.
      repos.push(...batch.map((x) => ({ ...fromGithubRepo(x as never), org })));
    } catch (e) {
      return { repos, complete: false, error: `page ${page}: ${(e as Error).message}` };
    }
    if (!hasNextPage(r.res.headers.get('link'))) return { repos, complete: true };
  }
  return { repos, complete: false, error: `more than ${MAX_PAGES} pages` };
}

async function fetchReadme(fullName: string): Promise<string | null> {
  for (const name of README_NAMES) {
    const text = await politeGetText(`https://raw.githubusercontent.com/${fullName}/HEAD/${name}`, { userAgent: UA, delays: [1_000] });
    if (text !== null) return text;
  }
  return null;
}

async function main(): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const problems: string[] = [];
  let recorded = 0;
  let listed = 0;
  // State and its change event commit together: a run that dies after saving
  // archived=1 but before writing the event would leave the next run seeing
  // archived=1 on both sides, and the archive would never be reported.
  const saveWithEvents = (save: () => void, events: ChangeEvent[]) => db.transaction(() => {
    save();
    recorded += recordEvents(db, events, now);
  })();
  let readmes = 0;

  const toRead: Array<{ repo: RepoSnapshot; checkedBefore: boolean; previous: string | null; neverRead: boolean }> = [];

  for (const org of GITHUB_ORGS) {
    const stored = loadOrgRepos(db, org);
    const listing = await listOrg(org);
    if (listing.error) problems.push(`${org}: ${listing.error}`);
    for (const repo of listing.repos) {
      const before = stored.get(repo.full_name);
      saveWithEvents(() => saveRepo(db, repo, now), diffRepo(before, repo));
      listed++;
      if (repo.fork) continue;
      if (before?.readme_checked_at && before.readme_checked_pushed_at === repo.pushed_at) continue;
      toRead.push({ repo, checkedBefore: Boolean(before?.readme_checked_at), previous: before?.readme_marker ?? null, neverRead: !before?.readme_checked_at });
    }
    if (listing.complete) {
      const res = prune({ table: 'github_repos', keyColumn: 'full_name', scopeColumn: 'org', scopeValue: org, liveKeys: listing.repos.map((r) => r.full_name) }, db);
      if (res.refused) problems.push(`${org}: prune refused, ${res.reason}`);
      else if (res.deleted) console.log(`[sync-repos] ${org}: pruned ${res.deleted} repositories no longer listed`);
    } else {
      problems.push(`${org}: listing incomplete, prune skipped`);
    }
  }

  toRead.sort((a, b) => Number(b.neverRead) - Number(a.neverRead));
  for (const item of toRead.slice(0, README_CAP)) {
    try {
      const text = await fetchReadme(item.repo.full_name);
      const notice = text ? detectReadmeNotice(text) : null;
      saveWithEvents(
        () => saveReadme(db, item.repo.full_name, notice, item.repo.pushed_at, now),
        readmeNoticeEvent(item.repo.full_name, item.repo.html_url, item.checkedBefore, item.previous, notice),
      );
      readmes++;
    } catch (e) {
      problems.push(`README ${item.repo.full_name}: ${(e as Error).message}`);
    }
    await sleep(README_PACE_MS);
  }
  const left = Math.max(0, toRead.length - README_CAP);
  if (left) {
    console.log(`[sync-repos] ${left} READMEs left for the next run`);
    problems.push(`${left} READMEs not read yet: their deprecation notices are unknown until the next run`);
  }

  const status = listed === 0 ? 'error' : problems.length ? 'partial' : 'success';
  logRun('repos', { status, items: listed, error: problems.length ? problems.join(' ; ').slice(0, 1000) : undefined }, db);
  console.log(`[sync-repos] ${listed} repositories listed, ${readmes} READMEs read, ${recorded} change events${problems.length ? `; ${problems.length} problems` : ''}`);
  for (const p of problems) console.warn(`  ${p}`);
  if (status === 'error') process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  guardSync('repos', main).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
