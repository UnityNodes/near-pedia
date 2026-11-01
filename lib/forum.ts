import { getDb } from './db';
import { ftsPrefixMatch } from './rank';
import { htmlToTextWithCode } from './html-extract';
import { SITE } from './site.config';

/** A forum post's rendered HTML (`cooked`) as plain text, code blocks kept readable. */
export function cookedToText(cooked: string | null | undefined): string {
  if (!cooked) return '';
  return htmlToTextWithCode(cooked);
}

/** A short single-line snippet of a post's text, for use as a search-result preview. */
export function cookedToSnippet(cooked: string | null | undefined, max = 200): string {
  const text = cookedToText(cooked).replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max) : text;
}

export interface ForumTopic {
  id: number;
  title: string;
  category_id: number;
  category_name: string | null;
  category_color: string | null;
  created_at: string;
  last_post_at: string;
  posts_count: number;
  reply_count: number;
  views: number;
  like_count: number;
  last_poster_username: string | null;
  url: string;
}

export type SortOption = 'activity' | 'newest' | 'discussed' | 'viewed';

export interface GetTopicsOptions {
  q?: string;
  category?: number;
  sort?: SortOption;
  page?: number;
  perPage?: number;
}

export interface GetTopicsResult {
  topics: ForumTopic[];
  total: number;
  page: number;
  totalPages: number;
}

const SORT_MAP: Record<SortOption, string> = {
  activity: 'ft.last_post_at DESC',
  newest: 'ft.created_at DESC',
  discussed: 'ft.posts_count DESC',
  viewed: 'ft.views DESC',
};

const SELECT_WITH_CAT = `
  SELECT ft.*, c.name as category_name, c.color as category_color
  FROM forum_topics ft
  LEFT JOIN categories c ON ft.category_id = c.id
`;

export function getTopics(opts: GetTopicsOptions): GetTopicsResult {
  const db = getDb();
  const page = Math.max(1, opts.page ?? 1);
  const perPage = opts.perPage ?? 30;
  const offset = (page - 1) * perPage;
  const orderBy = SORT_MAP[opts.sort ?? 'activity'];

  const conditions: string[] = [];
  const filterParams: unknown[] = [];
  if (opts.category) { conditions.push('ft.category_id = ?'); filterParams.push(opts.category); }

  if (opts.q && opts.q.trim()) {
    const ftsQ = ftsPrefixMatch(opts.q);
    if (!ftsQ) return { topics: [], total: 0, page, totalPages: 1 };
    const extra = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

    const countRow = db.prepare(
      `SELECT COUNT(*) as count FROM forum_topics ft JOIN forum_fts ON ft.id = forum_fts.rowid WHERE forum_fts MATCH ? ${extra}`
    ).get(ftsQ, ...filterParams) as { count: number };

    const topics = db.prepare(
      `${SELECT_WITH_CAT} JOIN forum_fts ON ft.id = forum_fts.rowid WHERE forum_fts MATCH ? ${extra} ORDER BY rank LIMIT ? OFFSET ?`
    ).all(ftsQ, ...filterParams, perPage, offset) as ForumTopic[];

    const total = countRow.count;
    return { topics, total, page, totalPages: Math.max(1, Math.ceil(total / perPage)) };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countRow = db.prepare(`SELECT COUNT(*) as count FROM forum_topics ft ${where}`).get(...filterParams) as { count: number };
  const topics = db.prepare(`${SELECT_WITH_CAT} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...filterParams, perPage, offset) as ForumTopic[];
  const total = countRow.count;
  return { topics, total, page, totalPages: Math.max(1, Math.ceil(total / perPage)) };
}

export function getTopicsTotalCount(): number {
  const db = getDb();
  return (db.prepare('SELECT COUNT(*) as c FROM forum_topics').get() as { c: number }).c;
}

export function getCategories(): { id: number; name: string; color: string | null; topic_count: number }[] {
  const db = getDb();
  // Derived, not the stored column: rendered directly beside the topic list
  // it filters (topic-filters.tsx), and Discourse's own topic_count excludes
  // the auto-generated "About the X category" topic that sync-forum still
  // syncs as a real row - every one of 29 categories was off by exactly 1,
  // undercounting what clicking the filter actually shows.
  return db.prepare(`
    SELECT c.id, c.name, c.color, (SELECT COUNT(*) FROM forum_topics t WHERE t.category_id = c.id) topic_count
    FROM categories c ORDER BY topic_count DESC
  `).all() as {
    id: number; name: string; color: string | null; topic_count: number;
  }[];
}

export interface ForumPost {
  id: number;
  topic_id: number;
  post_number: number;
  username: string | null;
  created_at: string;
  cooked: string;
  like_count: number;
}

export interface TopicWithPosts extends ForumTopic {
  posts: ForumPost[];
}

interface DiscourseTopicJson {
  id: number;
  title: string;
  category_id: number;
  created_at: string;
  last_posted_at: string;
  posts_count: number;
  reply_count: number;
  views: number;
  like_count: number;
  slug: string;
  last_poster_username?: string;
  post_stream?: {
    posts?: Array<{
      id: number;
      post_number: number;
      username: string;
      created_at: string;
      cooked: string;
      like_count: number;
    }>;
  };
}

async function fetchFromDiscourse(topicId: number): Promise<DiscourseTopicJson | null> {
  try {
    // /discussions/[id] renders on this call, so an upstream that stops
    // answering holds the page open for as long as it likes. The catch below
    // returns null on failure, which means a HANG is not even an error here -
    // it is a request that never finishes. Eight seconds is generous for a
    // Discourse topic and short enough that the page falls back to what the
    // database already holds.
    const res = await fetch(`https://forum.yourchain.example/t/${topicId}.json`, {
      headers: { 'User-Agent': `${SITE.name}/1.0` },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return await res.json() as DiscourseTopicJson;
  } catch {
    return null;
  }
}

export async function getTopicWithPosts(topicId: number): Promise<TopicWithPosts | null> {
  const db = getDb();

  let topic = db.prepare(`
    SELECT ft.*, c.name as category_name, c.color as category_color
    FROM forum_topics ft
    LEFT JOIN categories c ON ft.category_id = c.id
    WHERE ft.id = ?
  `).get(topicId) as ForumTopic | undefined;

  if (!topic) {
    const data = await fetchFromDiscourse(topicId);
    if (!data) return null;

    const now = new Date().toISOString();
    const url = `https://forum.yourchain.example/t/${data.slug}/${data.id}`;
    const rawPosts = data.post_stream?.posts ?? [];

    // posts_synced_at was missing from this column list, so a topic first
    // discovered here (a live visit beating sync-forum.ts's own crawl to it)
    // left the sync's own `posts_synced_at IS NULL` staleness check unable to
    // see the posts fetched just below - sync-forum.ts's next run would
    // re-fetch them from Discourse again even though they were already cached.
    // Only mark it synced when we actually got post data in this same call.
    db.prepare(`
      INSERT OR REPLACE INTO forum_topics
        (id, title, category_id, created_at, last_post_at, posts_count,
         reply_count, views, like_count, last_poster_username, url, synced_at, posts_synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.id, data.title, data.category_id, data.created_at,
      data.last_posted_at, data.posts_count, data.reply_count,
      data.views, data.like_count, data.last_poster_username ?? null,
      url, now, rawPosts.length > 0 ? now : null
    );

    topic = {
      id: data.id,
      title: data.title,
      category_id: data.category_id,
      category_name: null,
      category_color: null,
      created_at: data.created_at,
      last_post_at: data.last_posted_at,
      posts_count: data.posts_count,
      reply_count: data.reply_count,
      views: data.views,
      like_count: data.like_count,
      last_poster_username: data.last_poster_username ?? null,
      url,
    };

    if (rawPosts.length > 0) {
      const insert = db.prepare(`
        INSERT OR REPLACE INTO forum_posts (id, topic_id, post_number, username, created_at, cooked, like_count, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      db.transaction(() => {
        for (const p of rawPosts) {
          insert.run(p.id, topicId, p.post_number, p.username, p.created_at, p.cooked, p.like_count, now);
        }
      })();
      return {
        ...topic,
        posts: rawPosts.map(p => ({
          id: p.id, topic_id: topicId, post_number: p.post_number,
          username: p.username, created_at: p.created_at, cooked: p.cooked, like_count: p.like_count,
        })),
      };
    }

    return { ...topic, posts: [] };
  }

  const cached = db.prepare(
    'SELECT * FROM forum_posts WHERE topic_id = ? ORDER BY post_number'
  ).all(topicId) as ForumPost[];

  if (cached.length > 0) {
    return { ...topic, posts: cached };
  }

  const data = await fetchFromDiscourse(topicId);
  if (!data) return { ...topic, posts: [] };

  const posts = data.post_stream?.posts ?? [];
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT OR REPLACE INTO forum_posts (id, topic_id, post_number, username, created_at, cooked, like_count, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const p of posts) {
      insert.run(p.id, topicId, p.post_number, p.username, p.created_at, p.cooked, p.like_count, now);
    }
    // Same reasoning as the cache-miss branch above: we just cached this
    // topic's posts, so tell sync-forum.ts's staleness check that.
    if (posts.length > 0) {
      db.prepare('UPDATE forum_topics SET posts_synced_at = ? WHERE id = ?').run(now, topicId);
    }
  })();

  return {
    ...topic,
    posts: posts.map(p => ({
      id: p.id, topic_id: topicId, post_number: p.post_number,
      username: p.username, created_at: p.created_at, cooked: p.cooked, like_count: p.like_count,
    })),
  };
}
