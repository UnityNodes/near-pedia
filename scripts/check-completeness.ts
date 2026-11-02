/**
 * Ask every upstream how many it has, and compare with how many we hold.
 *
 * WHY. `sync_log` can say "the run finished"; it cannot say "the run
 * finished and we now hold what exists". A sync that pages through a feed
 * and silently stops early - a rate limit, a truncated response, a changed
 * page size - looks identical in sync_log to one that reached the end.
 *
 * PUBLIC COUNTERS ONLY, read from the same source-of-truth constant the
 * sync itself uses (TREE_URL, LLMS_URL, SRC, REPOS - all exported from
 * their sync scripts for exactly this). Comparing against a second, hand-typed
 * copy of the same URL measures the difference between two guesses at what
 * upstream is, not between us and upstream.
 *
 * SCOPE. Covered: ecosystem_projects (the same data file sync-ecosystem.ts
 * evaluates), doc_pages/docs (the same llms-full.txt sync-docs.ts parses),
 * github_releases (the same repo list sync-github-releases.ts uses),
 * github_items (SOURCES from sync-github-items.ts, the Search API's
 * total_count for open issues plus open pull requests, the scope the sync
 * stores) and github_discussions (REPOS from sync-github-discussions.ts,
 * GraphQL's discussions.totalCount per repo). Left out, and why:
 *
 *   forum_topics                Discourse publishes no total for a
 *                               category listing that counts what the
 *                               spam filter and the subcategory choice in
 *                               lib/gov-forum.ts leave.
 *   blog_posts / site docs      the sitemap the sync reads is itself the
 *                               total, so counting it again here would only
 *                               prove the sync agrees with itself.
 *   youtube_videos              would mean re-scraping YouTube's innertube
 *                               endpoint, the same fragile surface already
 *                               flagged as a scheduling risk elsewhere.
 *
 * A check that cannot reach its upstream reports `unknown`, not `ok`. An
 * unreachable counter is the same class of silence this script exists to end.
 *
 * Cadence: daily. Log: sync_log source='completeness'.
 */

import { getDb } from '../lib/db';
import { logRun, guardSync } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { SRC as ECOSYSTEM_SRC } from './sync-ecosystem';
import { LLMS_URL, HEADER_RE } from './sync-docs';
import { REPOS as RELEASE_REPOS } from './sync-github-releases';
import { SOURCES as ITEM_SOURCES } from './sync-github-items';
import { REPOS as DISCUSSION_REPOS } from './sync-github-discussions';
import { SITE } from '../lib/site.config';

const UA = `${SITE.name}-Bot/1.0 (+${SITE.url})`;
const POLITE_MS = 800;
/** The Search API allows 30 authenticated requests a minute. */
const SEARCH_PACE_MS = 2_100;

interface Outcome {
  name: string;
  ours: number;
  upstream: number | null;
  verdict: 'ok' | 'missing' | 'surplus' | 'unknown';
  note?: string;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function get(url: string, headers: Record<string, string> = {}): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(20_000) });
    // 429/403 mean back off, not "upstream is empty". Reporting null keeps
    // that out of the comparison entirely rather than scoring it as a loss.
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function count(sql: string): number {
  try {
    return (getDb().prepare(sql).get() as { n: number }).n;
  } catch {
    return -1;
  }
}

function judge(name: string, ours: number, upstream: number | null): Outcome {
  // count() returns -1 when its query throws; comparing that against a real
  // upstream total would report a nonsense gap as though it were measured.
  if (ours < 0) return { name, ours, upstream, verdict: 'unknown', note: 'local query failed, column or table missing' };
  if (upstream === null) return { name, ours, upstream, verdict: 'unknown', note: 'upstream counter unreachable' };
  return { name, ours, upstream, verdict: upstream === ours ? 'ok' : upstream > ours ? 'missing' : 'surplus' };
}

async function checkEcosystem(): Promise<Outcome> {
  const ours = count("SELECT COUNT(*) n FROM ecosystem_projects WHERE source = 'nearcatalog.xyz'");
  const raw = await get(ECOSYSTEM_SRC);
  if (!raw) return judge('ecosystem_projects', ours, null);
  try {
    // The same NEAR Catalog list sync-ecosystem.ts reads, one entry per project.
    const list = JSON.parse(raw) as Record<string, unknown> | null;
    return judge('ecosystem_projects', ours, list && typeof list === 'object' ? Object.keys(list).length : null);
  } catch {
    return judge('ecosystem_projects', ours, null);
  }
}

async function checkDocs(): Promise<Outcome> {
  // Same scope sync-docs.ts's own prune query uses: hand-seeded rows (the
  // yoursdk GitHub guides, .../SKILL.md) live under source='docs' too but
  // were never in llms-full.txt to begin with. Comparing the unscoped count
  // against llms-full.txt's total reported a false 107-vs-72 "surplus" the
  // first time this ran - discovered by reading the actual rows, not by
  // trusting the number.
  const ours = count("SELECT COUNT(*) n FROM doc_pages WHERE source='docs' AND url NOT LIKE '%.md'");
  const txt = await get(LLMS_URL);
  if (!txt) return judge('doc_pages/docs', ours, null);
  const matches = [...txt.matchAll(HEADER_RE)];
  return judge('doc_pages/docs', ours, matches.length);
}

async function checkGithubReleases(): Promise<Outcome[]> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const out: Outcome[] = [];
  for (const repo of RELEASE_REPOS) {
    const ours = count(`SELECT COUNT(*) n FROM github_releases WHERE repo='${repo}'`);
    let total = 0;
    let ok = true;
    // The releases endpoint has no total-count field; page until a short
    // page ends it. Same shape as the sync's own pagination, capped the
    // same way so a truncated response can't be scored as a count.
    for (let page = 1; page <= 10; page++) {
      const raw = await get(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, headers);
      if (!raw) { ok = false; break; }
      let batch: unknown[];
      try { batch = JSON.parse(raw); } catch { ok = false; break; }
      if (!Array.isArray(batch)) { ok = false; break; }
      total += batch.length;
      if (batch.length < 100) break;
      if (page === 10) { ok = false; break; } // hit the cap, this is a lower bound not a count
      await sleep(POLITE_MS);
    }
    out.push(judge(`github_releases/${repo}`, ours, ok ? total : null));
    await sleep(POLITE_MS);
  }
  return out;
}

async function checkGithubItems(): Promise<Outcome[]> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const out: Outcome[] = [];
  for (const source of ITEM_SOURCES) {
    for (const repoName of source.repos) {
      const full = `${source.org}/${repoName}`;
      // Matches sync-github-items.ts's own scope: 'open' sources only ever
      // store open items, so "ours" and the search query both drop closed
      // items too. An 'all' source (none declared today) would store and
      // ask about everything instead.
      const ours = count(
        source.state === 'open'
          ? `SELECT COUNT(*) n FROM github_items WHERE repo='${full}' AND state='open'`
          : `SELECT COUNT(*) n FROM github_items WHERE repo='${full}'`,
      );
      const q = source.state === 'open' ? `repo:${full} is:open` : `repo:${full}`;
      // Search API's total_count - not the sync's own paginated walk repeated
      // here, which would only prove the walk agrees with itself. Since 2025
      // the endpoint answers 422 unless the query names is:issue or
      // is:pull-request, so the two are asked apart and summed.
      let upstream: number | null = 0;
      for (const kind of ['is:issue', 'is:pull-request']) {
        const raw = await get(`https://api.github.com/search/issues?q=${encodeURIComponent(`${q} ${kind}`)}&per_page=1`, headers);
        let n: number | null = null;
        if (raw) {
          try { n = (JSON.parse(raw) as { total_count?: number }).total_count ?? null; } catch { /* leave null */ }
        }
        upstream = n === null || upstream === null ? null : upstream + n;
        await sleep(SEARCH_PACE_MS);
      }
      out.push(judge(`github_items/${full}`, ours, upstream));
    }
  }
  return out;
}

async function checkGithubDiscussions(): Promise<Outcome[]> {
  const token = process.env.GITHUB_TOKEN;
  const out: Outcome[] = [];
  for (const [owner, name] of DISCUSSION_REPOS) {
    const full = `${owner}/${name}`;
    const ours = count(`SELECT COUNT(*) n FROM github_discussions WHERE repo='${full}'`);
    let upstream: number | null = null;
    if (token) {
      try {
        const res = await fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': UA },
          body: JSON.stringify({
            query: 'query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ discussions{ totalCount } } }',
            variables: { owner, name },
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (res.ok) {
          const j = await res.json() as { data?: { repository?: { discussions?: { totalCount?: number } } }; errors?: unknown };
          // A repo with discussions disabled answers repository:null, not an
          // error - totalCount stays unmeasurable, not a false gap.
          if (!j.errors) upstream = j.data?.repository?.discussions?.totalCount ?? null;
        }
      } catch { /* leave null */ }
    }
    out.push(judge(`github_discussions/${full}`, ours, upstream));
    await sleep(POLITE_MS);
  }
  return out;
}

async function main(): Promise<void> {
  const results: Outcome[] = [];
  results.push(await checkEcosystem());
  await sleep(POLITE_MS);
  results.push(await checkDocs());
  await sleep(POLITE_MS);
  results.push(...await checkGithubReleases());
  results.push(...await checkGithubItems());
  results.push(...await checkGithubDiscussions());

  const pad = (s: string, n: number) => s.padEnd(n);
  for (const r of results) {
    const mark = { ok: 'ok     ', missing: 'MISSING', surplus: 'SURPLUS', unknown: '?      ' }[r.verdict];
    console.log(`  ${mark} ${pad(r.name, 28)} ours=${String(r.ours).padStart(6)} upstream=${String(r.upstream ?? '?').padStart(6)}${r.note ? `  ${r.note}` : ''}`);
  }

  const problems = results.filter(r => r.verdict === 'missing' || r.verdict === 'surplus');
  const unknown = results.filter(r => r.verdict === 'unknown');

  console.log(
    `\n${results.length} checks: ${results.filter(r => r.verdict === 'ok').length} ok, ` +
    `${problems.filter(r => r.verdict === 'missing').length} missing, ` +
    `${problems.filter(r => r.verdict === 'surplus').length} surplus, ${unknown.length} unmeasurable.`,
  );

  logRun('completeness', { status: problems.length ? 'error' : 'success', items: results.length });

  // Non-zero on a real, measured difference only. An unreachable counter is
  // worth logging and reading, but it is not a reason to fail a nightly run -
  // the network is allowed to be down.
  if (problems.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  guardSync('completeness', main).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
