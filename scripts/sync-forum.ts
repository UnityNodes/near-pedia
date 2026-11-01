/**
 * gov.near.org into categories, forum_topics and forum_posts over the plain
 * Discourse JSON API (no browser: the forum is not behind a challenge).
 *
 * Topics: each listing in lib/gov-forum.ts is paged newest-bumped first and
 * stops at the page whose topics are all at or before the listing's
 * watermark, so a run reads one page when nothing changed. A first run, or
 * `--full`, pages to the end.
 *
 * Posts: for listings marked `posts`, topics whose last post is newer than
 * their last post read, at most POST_TOPICS a run, newest first; long threads
 * through posts.json in chunks of 20. Edits do not move last_posted_at, so a
 * topic is also re-read after REREAD_DAYS.
 *
 *   npx tsx scripts/sync-forum.ts [--full]
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDb } from '../lib/db';
import { guardSync, logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { SITE } from '../lib/site.config';
import { politeGetJson } from '../lib/polite-fetch';
import { FORUM_LISTINGS, FORUM_ORIGIN, parseListing, parseTopic, type PostRow, type TopicRow } from '../lib/gov-forum';

const UA = `${SITE.slug}-sync/1.0 (+${SITE.publisher.url})`;
const FULL = process.argv.includes('--full');
const PACE_MS = 500;
const MAX_PAGES = 200;
const POST_TOPICS = Number(process.env.FORUM_POST_TOPICS ?? 40);
const POSTS_PER_REQUEST = 20;
const MAX_POSTS_PER_TOPIC = 400;
const REREAD_DAYS = 14;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = <T>(path: string) => politeGetJson<T>(`${FORUM_ORIGIN}${path}`, { userAgent: UA, headers: { Accept: 'application/json' } });

interface Category { id: number; name: string; color?: string; slug: string; topic_count: number }
interface CategoryDoc { category_list?: { categories?: Array<Category & { subcategory_list?: Category[] }> } }

/** Writes the categories and returns the ids whose topics get their posts read: each `posts` listing and its subcategories. */
async function syncCategories(now: string): Promise<{ count: number; postCategories: Set<number> }> {
  const doc = await get<CategoryDoc>('/categories.json?include_subcategories=true');
  const cats = doc?.category_list?.categories ?? [];
  if (cats.length === 0) throw new Error('categories.json returned no categories');
  const db = getDb();
  const ins = db.prepare(`INSERT INTO categories (id, name, color, slug, topic_count, synced_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, slug = excluded.slug, topic_count = excluded.topic_count, synced_at = excluded.synced_at`);
  let n = 0;
  const withPosts = new Set(FORUM_LISTINGS.filter((l) => l.posts).map((l) => l.id));
  const postCategories = new Set<number>();
  db.transaction(() => {
    for (const c of cats) {
      ins.run(c.id, c.name, c.color ?? null, c.slug, c.topic_count, now); n++;
      if (withPosts.has(c.id)) postCategories.add(c.id);
      for (const s of c.subcategory_list ?? []) {
        ins.run(s.id, s.name, s.color ?? null, s.slug, s.topic_count, now); n++;
        if (withPosts.has(c.id) || withPosts.has(s.id)) postCategories.add(s.id);
      }
    }
  })();
  return { count: n, postCategories };
}

function watermark(key: string): string | null {
  return (getDb().prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
}

function setWatermark(key: string, value: string, now: string): void {
  getDb().prepare(`INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, value, now);
}

async function syncListing(id: number, now: string): Promise<{ topics: number; complete: boolean }> {
  const db = getDb();
  const key = `forum:listing:${id}:bumped`;
  const mark = FULL ? null : watermark(key);
  const upsert = db.prepare(`INSERT INTO forum_topics (id, title, category_id, created_at, last_post_at, posts_count, reply_count, views, like_count, last_poster_username, url, synced_at)
      VALUES (@id, @title, @category_id, @created_at, @last_post_at, @posts_count, @reply_count, @views, @like_count, @last_poster_username, @url, @synced_at)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, category_id = excluded.category_id, last_post_at = excluded.last_post_at,
        posts_count = excluded.posts_count, reply_count = excluded.reply_count, views = excluded.views, like_count = excluded.like_count,
        last_poster_username = excluded.last_poster_username, url = excluded.url, synced_at = excluded.synced_at`);
  let newest = mark;
  let written = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const doc = await get<unknown>(`/c/${id}.json?page=${page}`);
    if (doc === null) throw new Error(`/c/${id}.json not found`);
    const { topics, hasMore } = parseListing(doc);
    const fresh = topics.filter((t: TopicRow) => t.pinned || !mark || (t.bumped_at ?? '') > mark);
    db.transaction(() => {
      for (const t of fresh) upsert.run({ ...t, synced_at: now });
    })();
    written += fresh.length;
    for (const t of topics) if (t.bumped_at && (!newest || t.bumped_at > newest)) newest = t.bumped_at;
    const reachedMark = mark !== null && topics.filter((t) => !t.pinned).every((t) => (t.bumped_at ?? '') <= mark);
    if (!hasMore || reachedMark) {
      if (newest) setWatermark(key, newest, now);
      return { topics: written, complete: true };
    }
    await sleep(PACE_MS);
  }
  return { topics: written, complete: false };
}

/**
 * Every post of a topic, or for a thread longer than MAX_POSTS_PER_TOPIC the
 * opening posts the first page carries plus the newest ones: a cap that kept
 * the oldest 400 dropped exactly the replies a reader comes for. `complete`
 * says whether the whole stream was read, which is what allows a prune.
 */
async function readPosts(topicId: number): Promise<{ posts: PostRow[]; complete: boolean }> {
  const doc = await get<unknown>(`/t/${topicId}.json`);
  if (doc === null) throw new Error('topic not found');
  const first = parseTopic(doc);
  const have = new Set(first.posts.map((p) => p.id));
  const missing = first.stream.filter((id) => !have.has(id));
  const rest = missing.length > MAX_POSTS_PER_TOPIC ? missing.slice(-MAX_POSTS_PER_TOPIC) : missing;
  const posts = [...first.posts];
  for (let i = 0; i < rest.length; i += POSTS_PER_REQUEST) {
    await sleep(PACE_MS);
    const ids = rest.slice(i, i + POSTS_PER_REQUEST).map((id) => `post_ids[]=${id}`).join('&');
    const chunk = await get<{ post_stream?: { posts?: unknown[] } }>(`/t/${topicId}/posts.json?${ids}`);
    if (!chunk?.post_stream) throw new Error(`posts.json for ${topicId} returned nothing`);
    posts.push(...parseTopic({ id: topicId, post_stream: { stream: [], posts: chunk.post_stream.posts ?? [] } }).posts);
  }
  return { posts, complete: rest.length === missing.length };
}

async function syncPosts(postCategories: ReadonlySet<number>, now: string, problems: string[]): Promise<number> {
  const db = getDb();
  const ids = [...postCategories];
  if (ids.length === 0) return 0;
  const due = db.prepare(`SELECT id FROM forum_topics WHERE category_id IN (${ids.map(() => '?').join(',')})
      AND (posts_synced_at IS NULL OR last_post_at > posts_synced_at OR posts_synced_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?))
      ORDER BY last_post_at DESC LIMIT ?`).all(...ids, `-${REREAD_DAYS} days`, POST_TOPICS) as { id: number }[];
  const ins = db.prepare(`INSERT INTO forum_posts (id, topic_id, post_number, username, created_at, cooked, like_count, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET cooked = excluded.cooked, like_count = excluded.like_count, synced_at = excluded.synced_at`);
  const mark = db.prepare('UPDATE forum_topics SET posts_synced_at = ? WHERE id = ?');
  const storedIds = db.prepare('SELECT id FROM forum_posts WHERE topic_id = ?');
  const delPost = db.prepare('DELETE FROM forum_posts WHERE id = ?');
  let read = 0;
  for (const { id } of due) {
    try {
      const { posts, complete } = await readPosts(id);
      db.transaction(() => {
        for (const p of posts) ins.run(p.id, p.topic_id, p.post_number, p.username, p.created_at, p.cooked, p.like_count, now);
        // A post hidden, deleted or withdrawn since the last read is no longer
        // served; only after a complete read, or a partial one would delete
        // the posts it skipped.
        if (complete) {
          const live = new Set(posts.map((p) => p.id));
          for (const r of storedIds.all(id) as { id: number }[]) if (!live.has(r.id)) delPost.run(r.id);
        }
        mark.run(now, id);
      })();
      read++;
    } catch (e) {
      problems.push(`topic ${id}: ${(e as Error).message}`);
      // Stamped anyway so a topic that always fails (removed, made private)
      // waits for its next post or the reread clock instead of taking one of
      // the run's slots every 15 minutes.
      mark.run(now, id);
    }
    await sleep(PACE_MS);
  }
  return read;
}

async function main(): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const problems: string[] = [];
  const { count: cats, postCategories } = await syncCategories(now);
  let topics = 0;
  for (const l of FORUM_LISTINGS) {
    try {
      const r = await syncListing(l.id, now);
      topics += r.topics;
      if (!r.complete) problems.push(`listing ${l.id}: stopped at ${MAX_PAGES} pages`);
    } catch (e) {
      problems.push(`listing ${l.id}: ${(e as Error).message}`);
    }
  }
  const threads = await syncPosts(postCategories, now, problems);
  try { db.exec("INSERT INTO forum_fts(forum_fts) VALUES('rebuild')"); } catch (e) { problems.push(`forum_fts rebuild: ${(e as Error).message}`); }
  logRun('forum', { status: problems.length ? 'partial' : 'success', items: topics, error: problems.length ? problems.join(' ; ').slice(0, 1000) : undefined }, db);
  console.log(`[sync-forum] ${cats} categories, ${topics} topics written, posts read for ${threads} threads${problems.length ? `; ${problems.length} problems` : ''}`);
  for (const p of problems) console.warn(`  ${p}`);
}

if (isEntrypoint(import.meta.url)) {
  guardSync('forum', main).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
