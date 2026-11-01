/**
 * Sync the FULL YourChain Discourse forum (forum.yourchain.example) via the CF bypass.
 * Pulls every topic across /latest.json pages, then every post in each topic via
 * the post_stream (chunked). Run under xvfb:  xvfb-run -a npx tsx scripts/sync-forum.ts
 */
import 'dotenv/config';
import { guardSync } from '../lib/sync-log';
import { getDb } from '../lib/db';
import { openCf } from '../lib/cf-fetch';
import { isSpamTopic } from '../lib/refusals';
import { deleteSourceEmbeddings } from '../lib/vector-store';
import { isoNowSql } from '../lib/formats';

const ORIGIN = 'https://forum.yourchain.example';

interface DiscourseCategory { id: number; name: string; color: string; slug: string; topic_count?: number; subcategory_list?: DiscourseCategory[] }
interface DiscoursePost { id: number; post_number: number; username: string; created_at: string; cooked: string; actions_summary?: { id: number; count?: number }[] }
interface TopicPage { topic_list?: { topics?: TopicRow[]; more_topics_url?: string } }
interface TopicJson { post_stream?: { stream?: number[]; posts?: DiscoursePost[] } }
interface TopicRow { id: number; title: string; category_id: number; created_at: string; last_posted_at: string; posts_count: number; reply_count: number; views: number; like_count: number; last_poster_username?: string; slug: string; }

// Existing rows that match the latest blocklist or patterns need to go too -
// filtering the crawl at insert time (below) only stops a NEW one from
// landing. Run this on every forum sync so a fresh entry in lib/refusals.ts's
// SPAM_TOPIC_IDS/SPAM_TITLE_PATTERNS retroactively clears the DB without a
// manual SQL pass, and scripts/check-refusals.ts asks forum_topics whether
// they still agree.
function cleanupExistingSpam() {
  const db = getDb();
  const rows = db.prepare('SELECT id, title FROM forum_topics').all() as { id: number; title: string }[];
  const toDelete = rows.filter(isSpamTopic).map(r => r.id);
  if (toDelete.length === 0) return;
  console.log(`Cleaning up ${toDelete.length} existing spam topic(s): ${toDelete.join(', ')}`);
  const delPost = db.prepare('DELETE FROM forum_posts WHERE topic_id = ?');
  const delTopic = db.prepare('DELETE FROM forum_topics WHERE id = ?');
  db.transaction(() => {
    for (const id of toDelete) { delPost.run(id); delTopic.run(id); }
  })();
  // Through the shared helper, which removes the chunk AND its vector -
  // deleting embedding_chunks directly leaves the vector behind (on a
  // 5-minute sync, orphans accumulate silently).
  for (const id of toDelete) deleteSourceEmbeddings('forum_topic', String(id));
  db.exec("INSERT INTO forum_fts(forum_fts) VALUES('rebuild')");
}

async function main() {
  const db = getDb();
  cleanupExistingSpam();
  const cf = await openCf(ORIGIN);
  console.log('CF session open');

  // ── categories ──
  try {
    // include_subcategories: Discourse returns only top-level categories by
    // default, nesting children under subcategory_list. Storing just the top
    // level left 70 of 250 topics pointing at a category_id with no row, so the
    // /discussions filter could not reach them at all.
    const cats = await cf.json<{ category_list?: { categories?: DiscourseCategory[] } }>('/categories.json?include_subcategories=true');
    const flatten = (nodes: DiscourseCategory[]): DiscourseCategory[] =>
      (nodes ?? []).flatMap((c) => [c, ...flatten(c.subcategory_list ?? [])]);
    const list = flatten(cats?.category_list?.categories ?? []);
    const insCat = db.prepare(`INSERT OR REPLACE INTO categories (id,name,color,slug,topic_count,synced_at) VALUES (?,?,?,?,?,${isoNowSql()})`);
    for (const c of list) insCat.run(c.id, c.name, c.color, c.slug, c.topic_count ?? 0);
    console.log('categories:', list.length);
  } catch (e) { console.warn('categories skip:', (e as Error).message); }

  // ── gather ALL topics: /latest pages UNION per-category crawl (catches
  //    pinned/closed/archived/subcategory topics /latest.json omits), deduped ──
  const byId = new Map<number, TopicRow>();
  const addBatch = (batch: TopicRow[]) => { for (const t of batch) if (t?.id) byId.set(t.id, t); };

  for (let page = 0; page < 40; page++) {
    let data: TopicPage;
    try { data = await cf.json<TopicPage>(`/latest.json?no_definitions=true&page=${page}`); }
    catch (e) { console.warn(`latest page ${page}:`, (e as Error).message); break; }
    const batch: TopicRow[] = data?.topic_list?.topics ?? [];
    if (batch.length === 0) break;
    addBatch(batch);
    if (!data?.topic_list?.more_topics_url) break;
  }
  console.log(`after /latest: ${byId.size} topics`);

  // full category list (incl subcategories) from site.json
  let cats: { id: number; slug: string }[] = [];
  try {
    const site = await cf.json<{ categories?: { id: number; slug: string }[] }>('/site.json');
    cats = (site?.categories ?? []).map((c) => ({ id: c.id, slug: c.slug }));
  } catch (e) { console.warn('site.json:', (e as Error).message); }
  for (const c of cats) {
    for (let page = 0; page < 40; page++) {
      let data: TopicPage;
      try { data = await cf.json<TopicPage>(`/c/${c.slug}/${c.id}.json?page=${page}`); }
      catch { break; }
      const batch: TopicRow[] = data?.topic_list?.topics ?? [];
      if (batch.length === 0) break;
      addBatch(batch);
      if (!data?.topic_list?.more_topics_url) break;
    }
  }
  const crawled: TopicRow[] = [...byId.values()];
  // The door: a blocklisted or pattern-matched topic never reaches
  // forum_topics in the first place. cleanupExistingSpam() above handles a
  // row that is already there; this is the other half, so a re-crawl every
  // few minutes can't put a cleaned-up topic straight back (the exact shape
  // of a sitemap catch-up that consulted neither list, deleting and
  // re-fetching the same "spam" topic forever).
  const topics = crawled.filter(t => !isSpamTopic(t));
  if (topics.length !== crawled.length) {
    console.log(`refused ${crawled.length - topics.length} spam topic(s) at the door`);
  }
  console.log(`after category crawl (${cats.length} cats): ${topics.length} topics`);

  // Upsert topic METADATA for all crawled topics WITHOUT touching posts_synced_at
  // (so the incremental post-backfill below can tell which topics are stale).
  const upTopic = db.prepare(`INSERT INTO forum_topics
    (id,title,category_id,created_at,last_post_at,posts_count,reply_count,views,like_count,last_poster_username,url,synced_at)
    VALUES (@id,@title,@category_id,@created_at,@last_post_at,@posts_count,@reply_count,@views,@like_count,@last_poster_username,@url,${isoNowSql()})
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, category_id=excluded.category_id,
      last_post_at=excluded.last_post_at, posts_count=excluded.posts_count, reply_count=excluded.reply_count,
      views=excluded.views, like_count=excluded.like_count, last_poster_username=excluded.last_poster_username,
      url=excluded.url, synced_at=${isoNowSql()}`);
  const upAll = db.transaction((arr: TopicRow[]) => {
    for (const t of arr) upTopic.run({ id: t.id, title: t.title, category_id: t.category_id, created_at: t.created_at,
      last_post_at: t.last_posted_at, posts_count: t.posts_count, reply_count: t.reply_count, views: t.views,
      like_count: t.like_count, last_poster_username: t.last_poster_username ?? null, url: `${ORIGIN}/t/${t.slug}/${t.id}` });
  });
  upAll(topics);

  const insPost = db.prepare(`INSERT OR REPLACE INTO forum_posts
    (id,topic_id,post_number,username,created_at,cooked,like_count,synced_at)
    VALUES (?,?,?,?,?,?,?,${isoNowSql()})`);
  const markSynced = db.prepare(`UPDATE forum_topics SET posts_synced_at=${isoNowSql()} WHERE id=?`);

  // Incremental, BOUNDED post backfill: each run pulls posts for the topics that
  // are new or have changed since their last post-sync (recent first), capped so
  // a single run never hammers Discourse's anon rate limit. Coverage accumulates
  // across cron runs until every topic's posts are stored.
  const PER_RUN = parseInt(process.env.FORUM_POST_TOPICS ?? '40', 10);
  const stale = db.prepare(`SELECT id FROM forum_topics
    WHERE posts_synced_at IS NULL OR posts_synced_at < last_post_at
    ORDER BY (posts_synced_at IS NULL) DESC, last_post_at DESC LIMIT ?`).all(PER_RUN) as { id: number }[];
  console.log(`post backfill: ${stale.length} stale topics this run (cap ${PER_RUN})`);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let totalPosts = 0;
  for (const { id } of stale) {
    await sleep(1300); // stay under Discourse anon rate limit (strict on /t/{id}.json)
    let topicJson: TopicJson;
    try { topicJson = await cf.json<TopicJson>(`/t/${id}.json?include_raw=false`); }
    catch (e) { console.warn(`topic ${id}:`, (e as Error).message); continue; }

    const stream: number[] = topicJson?.post_stream?.stream ?? [];
    const loaded: DiscoursePost[] = topicJson?.post_stream?.posts ?? [];
    const have = new Set(loaded.map((p) => p.id));
    const writePost = (p: DiscoursePost) => insPost.run(p.id, id, p.post_number, p.username, p.created_at, p.cooked, p.actions_summary?.find((a) => a.id === 2)?.count ?? 0);
    for (const p of loaded) { writePost(p); totalPosts++; }

    const missing = stream.filter((pid) => !have.has(pid));
    for (let i = 0; i < missing.length; i += 50) {
      const chunk = missing.slice(i, i + 50);
      const qs = chunk.map((pid) => `post_ids[]=${pid}`).join('&');
      try {
        const more = await cf.json<TopicJson>(`/t/${id}/posts.json?${qs}`);
        for (const p of (more?.post_stream?.posts ?? [])) { writePost(p); totalPosts++; }
      } catch (e) { console.warn(`posts chunk t${id}:`, (e as Error).message); }
    }
    markSynced.run(id);
  }

  try { db.exec("INSERT INTO forum_fts(forum_fts) VALUES('rebuild')"); } catch {}

  const tc = (db.prepare('SELECT COUNT(*) c FROM forum_topics').get() as { c: number }).c;
  const pc = (db.prepare('SELECT COUNT(*) c FROM forum_posts').get() as { c: number }).c;
  console.log(`\nDONE — forum_topics=${tc}, forum_posts=${pc} (wrote ${totalPosts} posts this run)`);
  await cf.close();
}

guardSync('forum', main).catch((e) => { console.error(e); process.exit(1); });
