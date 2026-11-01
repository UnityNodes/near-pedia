import { config } from 'dotenv';
import { guardSync } from '../lib/sync-log';
config({ path: '.env.local' });

import { getDb } from '../lib/db';
import { capText } from '../lib/cap-text';
import { isEntrypoint } from '../lib/is-entrypoint';

const BASE = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN;
const HEADERS: Record<string, string> = {
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'YOURPEDIA-sync/1.0',
  ...(TOKEN ? { 'Authorization': `Bearer ${TOKEN}` } : {}),
};
if (!TOKEN) {
  console.warn('GITHUB_TOKEN is not set - sync-github-items will hit the 60 req/h unauth limit.');
}

export interface SourceConfig {
  org: string;
  repos: string[];
  state: 'all' | 'open';
  maxPages: number;
}

// Exported so check-completeness.ts asks GitHub about the exact same
// org/repo/state list this sync reads, rather than a second, hand-typed copy
// that can drift from it.
export const SOURCES: SourceConfig[] = [
  // YourChain core stack - open items only (active discussion / WIP), capped pages
  {
    org: 'your-org',
    state: 'open',
    maxPages: 20,
    repos: [
      'yourchain-node',
      'yourchain-app',
      'yourchain-core',
      'CIPs',
      'docs',
      'yourchain-openrpc',
      'yourchain-specs',
      'networks',
    ],
  },
  // YourSDK
  {
    org: 'yoursdk',
    state: 'open',
    maxPages: 20,
    repos: ['yoursdk'],
  },
];

interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  user: { login: string } | null;
  created_at: string;
  html_url: string;
  labels: { name: string }[];
  pull_request?: unknown;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = res.headers.get('x-ratelimit-reset');
    throw new Error(`GitHub rate-limited until ${reset ? new Date(Number(reset) * 1000).toISOString() : 'unknown'}`);
  }
  if (!res.ok) throw new Error(`GitHub API ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * `complete` is true only when we walked the whole open set (a short/empty page
 * ended it). If we stopped because maxPages ran out, the list is a prefix - and
 * reconciling on a prefix would mark every unfetched open item as closed.
 */
async function fetchAllIssues(
  org: string, repo: string, state: string, maxPages: number,
): Promise<{ issues: GhIssue[]; complete: boolean }> {
  const issues: GhIssue[] = [];
  let complete = false;
  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE}/repos/${org}/${repo}/issues?state=${state}&per_page=100&page=${page}`;
    const batch = await fetchJson<GhIssue[]>(url);
    if (batch.length === 0) { complete = true; break; }
    issues.push(...batch);
    if (batch.length < 100) { complete = true; break; }
    await new Promise(r => setTimeout(r, 500));
  }
  return { issues, complete };
}

async function syncSource(source: SourceConfig): Promise<{ issues: number; prs: number; failed: string[] }> {
  console.log(`\n=== ${source.org} (state=${source.state}, maxPages=${source.maxPages}) ===`);

  const repos = source.repos.map(r => ({ name: r, full_name: `${source.org}/${r}` }));

  const db = getDb();
  // UPSERT rather than REPLACE so columns this sync does not fetch survive.
  const stmt = db.prepare(`
    INSERT INTO github_items (id, type, repo, number, title, body, state, author, created_at, url, labels, synced_at)
    VALUES (@id, @type, @repo, @number, @title, @body, @state, @author, @created_at, @url, @labels, @synced_at)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      body = excluded.body,
      state = excluded.state,
      labels = excluded.labels,
      synced_at = excluded.synced_at
  `);

  const syncedAt = new Date().toISOString();
  let totalIssues = 0;
  let totalPRs = 0;
  const failed: string[] = [];

  for (const repo of repos) {
    process.stdout.write(`  ${source.org}/${repo.name}: `);
    try {
      const { issues: items, complete } = await fetchAllIssues(source.org, repo.name, source.state, source.maxPages);
      const insert = db.transaction((list: GhIssue[]) => {
        for (const item of list) {
          const type = item.pull_request ? 'pr' : 'issue';
          stmt.run({
            id: `${source.org}/${repo.name}#${item.number}`,
            type,
            repo: `${source.org}/${repo.name}`,
            number: item.number,
            title: item.title,
            // Was a bare .slice(): 75 items were stored cut exactly at
            // 10000 chars with nothing to tell a reader (or
            // check-corpus-text) apart from a body that happened to end
            // there.
            body: item.body ? capText(item.body, 10_000) : null,
            state: item.state,
            author: item.user?.login ?? null,
            created_at: item.created_at,
            url: item.html_url,
            labels: item.labels.map(l => l.name).join(','),
            synced_at: syncedAt,
          });
          if (type === 'pr') totalPRs++;
          else totalIssues++;
        }
      });
      insert(items);

      // Reconcile: we only ever fetch state=open, and the upsert alone can
      // never write 'closed' - so an item merged/closed upstream stayed "open"
      // forever and /code?state=closed was permanently empty.
      // Guards: only when the open set was walked completely AND is non-empty,
      // so a rate-limited or empty response can't mass-close a repo.
      let closed = 0;
      if (source.state === 'open' && complete && items.length > 0) {
        const seen = new Set(items.map(i => `${source.org}/${repo.name}#${i.number}`));
        const openRows = db
          .prepare("SELECT id FROM github_items WHERE repo = ? AND state = 'open'")
          .all(`${source.org}/${repo.name}`) as { id: string }[];
        const gone = openRows.filter(r => !seen.has(r.id)).map(r => r.id);
        if (gone.length > 0) {
          const close = db.prepare("UPDATE github_items SET state = 'closed', synced_at = ? WHERE id = ?");
          db.transaction((ids: string[]) => { for (const id of ids) close.run(syncedAt, id); })(gone);
          closed = gone.length;
        }
      }

      console.log(`${items.length} items${closed ? `, ${closed} closed` : ''}`);
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.log(`FAILED - ${err instanceof Error ? err.message : err}`);
      failed.push(`${source.org}/${repo.name}`);
    }
  }

  return { issues: totalIssues, prs: totalPRs, failed };
}

async function syncGithub() {
  let totalIssues = 0;
  let totalPRs = 0;
  const failed: string[] = [];

  for (const source of SOURCES) {
    try {
      const r = await syncSource(source);
      totalIssues += r.issues;
      totalPRs += r.prs;
      failed.push(...r.failed);
    } catch (err) {
      console.error(`source ${source.org} FAILED:`, err instanceof Error ? err.message : err);
      failed.push(source.org);
    }
  }

  const repoCount = SOURCES.reduce((s, src) => s + src.repos.length, 0);
  console.log(`\nGitHub items sync done: ${totalIssues} issues, ${totalPRs} PRs across ${repoCount} repos.`);
  if (failed.length) console.warn(`failures: ${failed.join(', ')}`);
}

// isEntrypoint, not a bare call: check-completeness.ts imports SOURCES above -
// a bare guardSync() ran this sync for real against prod the moment that
// import was added, discovered live while building that check.
if (isEntrypoint(import.meta.url)) {
  guardSync('github-items', syncGithub).catch((err) => {
    console.error('GitHub items sync failed:', err);
    process.exit(1);
  });
}
