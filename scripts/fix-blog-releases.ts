/**
 * Make /blog, /news and /releases show real YourChain data using the template's
 * tag-driven blog machinery (releases live in blog_posts).
 *  - tag the real blog posts 'blog,news' so getBlogPosts(BLOG_TAGS) finds them
 *  - copy github_releases into blog_posts tagged 'release-notes' so
 *    getReleasePosts(RELEASE_TAGS) finds them and /releases/[id] detail resolves
 */
import Database from 'better-sqlite3';
import path from 'path';
import { marked } from 'marked';
import type { GithubReleasesRow } from '../lib/db-rows';

const db = new Database(path.join(process.cwd(), 'data', 'cips.db'));
db.pragma('foreign_keys = OFF');

// 1. tag the real blog posts so /blog and /news surface them
const tagged = db.prepare(
  "UPDATE blog_posts SET tags='blog,news' WHERE tags IS NULL OR tags NOT LIKE '%release-notes%'"
).run();
console.log('blog posts re-tagged:', tagged.changes);

// 2. copy github_releases → blog_posts (tagged release-notes)
const rels = db.prepare(
  'SELECT id, repo, tag, name, body, published_at, url, synced_at FROM github_releases'
).all() as Pick<GithubReleasesRow, 'id' | 'repo' | 'tag' | 'name' | 'body' | 'published_at' | 'url' | 'synced_at'>[];

const ins = db.prepare(`INSERT OR REPLACE INTO blog_posts
  (id, title, excerpt, content_text, content_html, author, published_at, url, tags, synced_at)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);

const clean = (s: string) => (s || '').replace(/[#>*`_~\[\]()|-]+/g, ' ').replace(/\s+/g, ' ').trim();

let n = 0;
const tx = db.transaction((arr: typeof rels) => {
  for (const r of arr) {
    const title = r.name && r.name.trim() ? r.name : `${r.repo} ${r.tag}`;
    const body = r.body || '';
    const html = body ? (marked.parse(body) as string) : null;
    ins.run(
      `rel-${r.id}`,
      `${r.repo.split('/').pop()} ${r.tag}${r.name && r.name !== r.tag ? ' — ' + r.name : ''}`.trim(),
      clean(body).slice(0, 200),
      body,
      html,
      r.repo,
      r.published_at,
      r.url,
      'release-notes',
      r.synced_at,
    );
    n++;
  }
});
tx(rels);
console.log('releases inserted into blog_posts:', n);

const counts = {
  blog: (db.prepare("SELECT COUNT(*) c FROM blog_posts WHERE tags LIKE '%blog%'").get() as { c: number }).c,
  releases: (db.prepare("SELECT COUNT(*) c FROM blog_posts WHERE tags LIKE '%release-notes%'").get() as { c: number }).c,
  total: (db.prepare('SELECT COUNT(*) c FROM blog_posts').get() as { c: number }).c,
};
console.log('counts:', JSON.stringify(counts));
db.close();
