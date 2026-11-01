/**
 * Sync the FULL NEAR blog (blog.yourchain.example, Ghost) via the CF bypass.
 * sitemap-posts.xml lists every post; fetch each and extract title + content.
 * Run under xvfb:  xvfb-run -a npx tsx scripts/sync-blog.ts
 */
import 'dotenv/config';
import { guardSync, logRun } from '../lib/sync-log';
import { prune } from '../lib/prune';
import { pruneConfirmingUrls } from '../lib/confirm-gone';
import { parse } from 'node-html-parser';
import { getDb } from '../lib/db';
import { openCf } from '../lib/cf-fetch';
import { isoNowSql } from '../lib/formats';
import { htmlToTextWithCode } from '../lib/html-extract';
import { SITE } from '../lib/site.config';

const ORIGIN = 'https://blog.yourchain.example';

function attr(root: ReturnType<typeof parse>, sel: string, name: string): string | null {
  const el = root.querySelector(sel);
  return el ? el.getAttribute(name) ?? null : null;
}

async function main() {
  const db = getDb();
  const cf = await openCf(ORIGIN);
  console.log('CF session open');

  // 1. enumerate all post URLs from the sitemap
  const xml = await cf.text('/sitemap-posts.xml');
  const urls = [...xml.matchAll(/<loc>(https:\/\/blog\.yourchain\.org\/[^<]+)<\/loc>/g)]
    .map((m) => m[1])
    .filter((u) => !u.includes('/content/images/') && !u.endsWith('/sitemap-posts.xml'));
  const postUrls = [...new Set(urls)];
  console.log('post URLs in sitemap:', postUrls.length);

  // ON CONFLICT (not INSERT OR REPLACE): a re-scrape that misses the
  // article:published_time meta tag - e.g. a Cloudflare challenge page served
  // with HTTP 200 - would otherwise overwrite a good date with NULL.
  // Keep the stored date whenever the incoming one is empty.
  const ins = db.prepare(`INSERT INTO blog_posts
    (id,title,excerpt,content_text,content_html,author,published_at,url,tags,synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,${isoNowSql()})
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      excerpt = excluded.excerpt,
      content_text = excluded.content_text,
      content_html = excluded.content_html,
      author = excluded.author,
      published_at = CASE
        WHEN excluded.published_at IS NOT NULL AND excluded.published_at != ''
          THEN excluded.published_at
        ELSE blog_posts.published_at
      END,
      url = excluded.url,
      tags = excluded.tags,
      synced_at = excluded.synced_at`);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let n = 0;
  for (const url of postUrls) {
    await sleep(300);
    let html: string;
    try { html = await cf.text(url); } catch (e) { console.warn('post', url, (e as Error).message); continue; }
    const root = parse(html);
    const slug = url.replace(/\/$/, '').split('/').pop() || url;
    const title = attr(root, 'meta[property="og:title"]', 'content') || root.querySelector('h1')?.text?.trim() || slug;
    const excerpt = attr(root, 'meta[property="og:description"]', 'content') || attr(root, 'meta[name="description"]', 'content') || '';
    const published = attr(root, 'meta[property="article:published_time"]', 'content');
    const author = attr(root, 'meta[property="article:author"]', 'content') || attr(root, 'meta[name="author"]', 'content') || 'NEAR Labs';
    const body = root.querySelector('.gh-content') || root.querySelector('.post-content') || root.querySelector('.post-full-content') || root.querySelector('article');
    const contentHtml = body ? body.innerHTML : '';
    // node-html-parser's bare .text joins every text node with nothing in
    // between - no space or newline at a </p></p> or </div><div> boundary -
    // so "...devops perspective." and "Community teams..." landed glued
    // together as "perspective.Community" in the stored text (and in every
    // embedding chunk built from it). htmlToTextWithCode() already solves
    // this correctly for the doc-crawling syncs (inserts a newline at each
    // block-level closing tag before stripping markup); this just adopts the
    // existing shared helper instead of a second, incorrect implementation.
    const contentText = body ? htmlToTextWithCode(contentHtml) : excerpt;
    ins.run(slug, title, excerpt.slice(0, 300), contentText, contentHtml, author, published, url, 'blog,news');
    n++;
    if (n % 10 === 0) console.log(`  ${n}/${postUrls.length} posts`);
  }

  // Drop posts the sitemap no longer lists. This only ever inserted, so a post
  // Ghost unpublished stayed served: the sitemap held 69 posts and the table 70.
  // The sitemap is the whole set (an empty or challenge page yields no URLs and
  // prune refuses an empty key set), and a post that failed to fetch above is
  // still listed there, so it keeps its row. A blog that moves its permalinks
  // reads as a blog that went down, so candidates are probed for a real 404.
  const problems: string[] = [];
  const { result: pruned, report } = await pruneConfirmingUrls(
    {
      table: 'blog_posts',
      keyColumn: 'url',
      scopeColumn: 'tags',
      scopeValue: 'blog,news',
      liveKeys: postUrls,
    },
    (spec) => prune(spec, db),
    { userAgent: `Mozilla/5.0 (compatible; ${SITE.name}/1.0)`, delayMs: 400 },
  );
  if (report.confirmed) console.log(`  confirmed ${report.confirmed} of ${report.candidates} candidate(s) gone upstream (404/410)`);
  if (pruned.refused) {
    problems.push(`prune refused, ${pruned.reason}`);
    console.warn(`  prune REFUSED: ${pruned.reason}`);
  } else if (pruned.deleted) {
    console.log(`  pruned ${pruned.deleted} post(s) no longer in the sitemap`);
  }

  try { db.exec("INSERT INTO blog_posts_fts(blog_posts_fts) VALUES('rebuild')"); } catch {}
  const total = (db.prepare("SELECT COUNT(*) c FROM blog_posts WHERE tags LIKE '%blog%'").get() as { c: number }).c;
  console.log(`DONE — wrote ${n} blog posts; blog_posts(blog) total ${total}`);
  await cf.close();
  if (problems.length) logRun('blog', { status: 'partial', items: n, error: problems.join(' ; ').slice(0, 1000) }, db);
  return n;
}
guardSync('blog', main).catch((e) => { console.error(e); process.exit(1); });
