import { config } from 'dotenv';
import { PAGE_ATTEMPTS, RELEASES_PER_PAGE, hasNextPage, pageIsUnreliable } from '../lib/github-pages';
config({ path: '.env.local' });

import { getDb } from '../lib/db';
import { guardSync, logRun } from '../lib/sync-log';
import { prune } from '../lib/prune';
import { marked } from 'marked';
import { isEntrypoint } from '../lib/is-entrypoint';
import { RELEASE_REPOS, repoName } from '../lib/release-sources';
import { releaseSummary } from '../lib/release-text';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Set when any repo fetch fails (rate limit / HTTP error) so the run is logged
// as 'failed' instead of silently reporting success on zero written rows.
let fetchFailed = false;

// Core YourChain repos: consensus node + app, plus
// the OpenRPC spec repo and YourSDK.
// Exported so check-completeness.ts checks the same repo list this sync
// reads, rather than a second copy that can drift from it.
export const REPOS: readonly string[] = RELEASE_REPOS;
const EXCERPT_MAX = 280;

interface GithubRelease {
  id: number;
  node_id: string;
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
}

interface FetchedReleases {
  releases: GithubRelease[];
  // True only when the read reached upstream's last page. A failed page or the
  // page cap leaves a hole, and a prune over a hole deletes real releases.
  complete: boolean;
}

async function fetchReleases(repo: string): Promise<FetchedReleases> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'yourpedia-sync',
  };
  if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;

  const all: GithubRelease[] = [];
  let complete = false;
  let previousHadNext = false;
  for (let page = 1; page <= 10; page++) {
    const url = `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`;
    let res = await fetch(url, { headers });
    for (let attempt = 1; attempt < PAGE_ATTEMPTS && res.ok; attempt++) {
      const rows = (await res.clone().json()) as unknown;
      const count = Array.isArray(rows) ? rows.length : 0;
      if (!pageIsUnreliable(page, count, RELEASES_PER_PAGE, hasNextPage(res.headers.get('link')), 0, previousHadNext)) break;
      console.warn(`[sync-releases] ${repo}: page ${page} returned ${count} releases and looks cut short (attempt ${attempt} of ${PAGE_ATTEMPTS})`);
      await new Promise(resolve => setTimeout(resolve, attempt * 3000));
      res = await fetch(url, { headers });
    }
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers.get('x-ratelimit-remaining');
        console.warn(`[sync-releases] ${repo}: HTTP ${res.status} (rate limited, remaining=${remaining})`);
      } else {
        console.warn(`[sync-releases] ${repo}: HTTP ${res.status}`);
      }
      // Record the failure so the run is not logged as a success. Without this
      // the sync ran every 15 min for 16 days, wrote nothing, and reported
      // status='success' - so staleness checks never fired.
      fetchFailed = true;
      break;
    }
    const batch = (await res.json()) as GithubRelease[];
    if (Array.isArray(batch) && pageIsUnreliable(page, batch.length, RELEASES_PER_PAGE, hasNextPage(res.headers.get('link')), 0, previousHadNext)) {
      console.warn(`[sync-releases] ${repo}: page ${page} is still cut short after ${PAGE_ATTEMPTS} attempts`);
      fetchFailed = true;
      break;
    }
    previousHadNext = hasNextPage(res.headers.get('link'));
    if (!Array.isArray(batch) || batch.length === 0) { complete = true; break; }
    all.push(...batch);
    if (batch.length < 100) { complete = true; break; } // last page
  }
  return { releases: all, complete };
}


async function main() {
  const db = getDb();

  const upsertRelease = db.prepare(`
    INSERT OR REPLACE INTO github_releases (id, repo, tag, name, body, published_at, url, synced_at, prerelease)
    VALUES (@id, @repo, @tag, @name, @body, @published_at, @url, @synced_at, @prerelease)
  `);

  const upsertBlog = db.prepare(`
    INSERT OR REPLACE INTO blog_posts
      (id, title, excerpt, content_text, content_html, author, published_at, url, tags, synced_at)
    VALUES (@id, @title, @excerpt, @content_text, @content_html, @author, @published_at, @url, @tags, @synced_at)
  `);

  const now = new Date().toISOString();

  // Fetch all repos first (network), then write in one transaction (idempotent).
  const fetched: Array<{ repo: string; releases: GithubRelease[]; complete: boolean }> = [];
  for (const repo of REPOS) {
    const { releases, complete } = await fetchReleases(repo);
    // skip drafts; keep prereleases (YourChain ships -testnet/-devnet tags)
    const usable = releases.filter((r) => !r.draft);
    fetched.push({ repo, releases: usable, complete });
    console.log(`[sync-releases] ${repo}: ${usable.length} releases`);
  }

  let total = 0;
  const writeAll = db.transaction(() => {
    for (const { repo, releases } of fetched) {
      const rName = repoName(repo);
      for (const r of releases) {
        // Use the numeric release id stringified (matches existing rows +
        // keeps blog mirror id 'rel-<id>' stable across re-runs).
        const releaseId = String(r.id);
        const body = r.body ?? '';

        upsertRelease.run({
          id: releaseId,
          repo,
          tag: r.tag_name,
          name: r.name,
          body,
          published_at: r.published_at,
          url: r.html_url,
          synced_at: now,
          // GitHub's own flag, fetched all along (see the GithubRelease
          // interface above) but never stored: a tag can look stable and
          // still be marked prerelease, or the reverse, which a tag-only
          // stability check cannot see. Stored as 0/1 for SQLite.
          prerelease: r.prerelease ? 1 : 0,
        });

        const contentHtml = body ? (marked.parse(body) as string) : '';
        const excerpt = releaseSummary(body, EXCERPT_MAX) || null;

        upsertBlog.run({
          id: `rel-${releaseId}`,
          title: `${rName} ${r.tag_name}`,
          excerpt,
          content_text: body,
          content_html: contentHtml,
          author: repo,
          published_at: r.published_at,
          url: r.html_url,
          tags: `release-notes,${rName}`,
          synced_at: now,
        });

        total++;
      }
    }
  });
  writeAll();

  // Drop what upstream no longer publishes. This sync only ever inserted, so a
  // release GitHub deleted or re-created under a new id stayed served next to
  // its replacement: v0.33.1-devnet and a duplicate v0.33.2-testnet were held for
  // ten days after upstream dropped them, which kept check-completeness red.
  // The blog_posts mirror rows (rel-<id>) go with them.
  const problems: string[] = [];
  for (const { repo, releases, complete } of fetched) {
    if (!complete) {
      problems.push(`${repo}: fetch incomplete, prune skipped`);
      continue;
    }
    const gone = prune({
      table: 'github_releases',
      keyColumn: 'id',
      scopeColumn: 'repo',
      scopeValue: repo,
      liveKeys: releases.map((r) => String(r.id)),
    }, db);
    const mirrored = prune({
      table: 'blog_posts',
      keyColumn: 'id',
      scopeColumn: 'author',
      scopeValue: repo,
      scopeWhere: "id LIKE 'rel-%'",
      liveKeys: releases.map((r) => `rel-${r.id}`),
    }, db);
    for (const [what, res] of [['release', gone], ['release blog mirror', mirrored]] as const) {
      if (res.refused) {
        problems.push(`${repo}: ${what} prune refused, ${res.reason}`);
        console.warn(`[sync-releases] ${repo}: ${what} prune REFUSED: ${res.reason}`);
      } else if (res.deleted) {
        console.log(`[sync-releases] ${repo}: pruned ${res.deleted} ${what}(s) upstream no longer publishes`);
      }
    }
  }

  // Rebuild FTS index for the mirrored blog posts so /releases search works.
  try {
    db.prepare("INSERT INTO blog_posts_fts(blog_posts_fts) VALUES('rebuild')").run();
  } catch (e) {
    console.warn('[sync-releases] blog_posts_fts rebuild skipped:', (e as Error).message);
  }

  logRun('github-releases', {
    status: fetchFailed ? 'error' : problems.length ? 'partial' : 'success',
    items: total,
    error: problems.length ? problems.join(' ; ').slice(0, 1000) : undefined,
  }, db);

  console.log(`[sync-releases] done: ${total} releases written${fetchFailed ? ' (WITH FETCH FAILURES - logged as failed)' : ''}`);
  if (fetchFailed) {
    process.exitCode = 1;
  }
}

// isEntrypoint, not a bare call: check-completeness.ts imports REPOS above
// so its own count checks the same repo list this sync uses. Without this
// guard, that import ran the whole sync against the live database and
// burned real GitHub API quota - discovered empirically on 2026-08-02 when
// check-completeness.ts's first run did exactly that (3 of 5 repos hit the
// rate limit as a direct result).
if (isEntrypoint(import.meta.url)) {
  // guardSync's wroteItsOwn check sees the row main() already wrote (success
  // or the fetchFailed degraded case) and skips its own; it only steps in
  // when main() throws before reaching that INSERT - a truly fatal error
  // that used to leave no sync_log row at all. check-scheduled.ts's
  // UNGUARDED check exists for exactly this shape.
  guardSync('github-releases', main).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
