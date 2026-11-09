/**
 * The NEAR blogs (lib/near-blogs.ts: near.org and near.ai) into blog_posts.
 * Each sitemap is the set of posts; a post is read once, and again only with
 * --full. A post the sitemap stops listing is removed through
 * pruneConfirmingUrls, scoped to its blog's tag, so one blog's outage cannot
 * touch the other's rows or the release-note rows sync-github-releases keeps
 * in the same table.
 *
 *   npx tsx scripts/sync-blog.ts [--full]
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDb } from '../lib/db';
import { guardSync, logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { SITE } from '../lib/site.config';
import { politeFetch } from '../lib/polite-fetch';
import { prune } from '../lib/prune';
import { pruneConfirmingUrls } from '../lib/confirm-gone';
import { BLOG_SOURCES, postUrls, readPost, type BlogSource } from '../lib/near-blogs';

const UA = `${SITE.slug}-sync/1.0 (+${SITE.publisher.url})`;
const FULL = process.argv.includes('--full');
const PACE_MS = 400;
const MAX_PRUNE_RATIO = 0.2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function text(url: string): Promise<string | null> {
  const r = await politeFetch(url, { userAgent: UA, timeoutMs: 30_000 });
  return r.kind === 'ok' ? r.res.text() : null;
}

async function syncSource(source: BlogSource, problems: string[]): Promise<number> {
  const db = getDb();
  const xml = await text(source.sitemap);
  const urls = xml ? postUrls(xml, source) : [];
  if (urls.length === 0) {
    problems.push(`${source.label}: sitemap listed no posts`);
    return 0;
  }
  const held = new Set((db.prepare('SELECT url FROM blog_posts WHERE tags = ?').all(source.label) as Array<{ url: string }>).map((r) => r.url));
  const todo = FULL ? urls : urls.filter((u) => !held.has(u));
  const upsert = db.prepare(`INSERT INTO blog_posts (id, title, excerpt, content_text, content_html, author, published_at, url, tags, synced_at)
    VALUES (@id, @title, @excerpt, @content_text, NULL, @author, @published_at, @url, @tags, @synced_at)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, excerpt = excluded.excerpt, content_text = excluded.content_text,
      author = excluded.author, published_at = COALESCE(excluded.published_at, blog_posts.published_at), url = excluded.url,
      tags = excluded.tags, synced_at = excluded.synced_at`);
  const dropShell = db.prepare('DELETE FROM blog_posts WHERE url = ? AND tags = ?');
  let written = 0;
  let unreadable = 0;
  let shells = 0;
  for (const url of todo) {
    await sleep(PACE_MS);
    let html: string | null = null;
    try { html = await text(url); } catch (e) { console.warn(`  ${url}: ${(e as Error).message}`); }
    const read = readPost(html, url, source);
    if (read.kind === 'no-text') {
      shells++;
      dropShell.run(url, source.label);
      continue;
    }
    if (read.kind === 'unreadable') { unreadable++; continue; }
    const { post } = read;
    upsert.run({ ...post, synced_at: new Date().toISOString() });
    written++;
    if (written % 50 === 0) console.log(`  ${source.label}: ${written}/${todo.length}`);
  }
  if (unreadable) problems.push(`${source.label}: ${unreadable} of ${todo.length} post pages unreadable`);
  if (shells) console.log(`  ${source.label}: ${shells} post pages carry no article text (video or link-only posts), not stored`);

  const { result, report } = await pruneConfirmingUrls(
    { table: 'blog_posts', keyColumn: 'url', scopeColumn: 'tags', scopeValue: source.label, liveKeys: urls, maxDeleteRatio: MAX_PRUNE_RATIO },
    (spec) => prune(spec, db),
    { userAgent: UA, delayMs: PACE_MS },
  );
  if (result.refused) problems.push(`${source.label} prune refused: ${result.reason}`);
  else if (report.overCap) problems.push(`${source.label}: ${report.candidates} removal candidates over the probe cap`);
  console.log(`[sync-blog] ${source.label}: ${urls.length} in the sitemap, ${written} read, ${result.deleted} removed`);
  return written;
}

async function main(): Promise<void> {
  const db = getDb();
  const problems: string[] = [];
  let total = 0;
  for (const source of BLOG_SOURCES) {
    try {
      total += await syncSource(source, problems);
    } catch (e) {
      problems.push(`${source.label}: ${(e as Error).message}`);
    }
  }
  try { db.exec("INSERT INTO blog_posts_fts(blog_posts_fts) VALUES('rebuild')"); } catch (e) { problems.push(`blog_posts_fts rebuild: ${(e as Error).message}`); }
  const held = (db.prepare(`SELECT COUNT(*) n FROM blog_posts WHERE tags IN (${BLOG_SOURCES.map(() => '?').join(',')})`).get(...BLOG_SOURCES.map((s) => s.label)) as { n: number }).n;
  if (held === 0) throw new Error(`no NEAR blog post stored: ${problems.join(' ; ')}`);
  logRun('blog', { status: problems.length ? 'partial' : 'success', items: total, error: problems.join(' ; ').slice(0, 1000) || undefined }, db);
  for (const p of problems) console.warn(`  ${p}`);
}

if (isEntrypoint(import.meta.url)) {
  guardSync('blog', main).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
