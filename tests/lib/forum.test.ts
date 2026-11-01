import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '@/lib/db';
import { getTopics, getCategories } from '@/lib/forum';

function insertCategory(db: ReturnType<typeof getDb>, overrides: Partial<{
  id: number; name: string; color: string; slug: string; topic_count: number;
}> = {}) {
  const defaults = { id: 57, name: 'App Development', color: '0088CC', slug: 'app-dev', topic_count: 100 };
  const row = { ...defaults, ...overrides };
  db.prepare(
    'INSERT OR REPLACE INTO categories (id, name, color, slug, topic_count, synced_at) VALUES (@id, @name, @color, @slug, @topic_count, @synced_at)'
  ).run({ ...row, synced_at: new Date().toISOString() });
}

function insertTopic(db: ReturnType<typeof getDb>, overrides: Partial<{
  id: number; title: string; category_id: number; posts_count: number;
  reply_count: number; views: number; like_count: number;
  last_poster_username: string; created_at: string; last_post_at: string;
}> = {}) {
  const defaults = {
    id: 1, title: 'Test topic', category_id: 57,
    posts_count: 5, reply_count: 4, views: 100, like_count: 2,
    last_poster_username: 'alice',
    created_at: '2026-01-01T00:00:00.000Z',
    last_post_at: '2026-01-02T00:00:00.000Z',
    url: 'https://forum.yourchain.example/t/test/1',
  };
  const row = { ...defaults, ...overrides };
  db.prepare(
    'INSERT OR REPLACE INTO forum_topics (id, title, category_id, posts_count, reply_count, views, like_count, last_poster_username, created_at, last_post_at, url, synced_at) VALUES (@id, @title, @category_id, @posts_count, @reply_count, @views, @like_count, @last_poster_username, @created_at, @last_post_at, @url, @synced_at)'
  ).run({ ...row, synced_at: new Date().toISOString() });
}

function rebuildForumFts(db: ReturnType<typeof getDb>) {
  db.exec("INSERT INTO forum_fts(forum_fts) VALUES('rebuild')");
}

describe('getTopics', () => {
  beforeEach(() => {
    resetDb();
    const db = getDb();
    insertCategory(db, { id: 57, name: 'App Development' });
    insertCategory(db, { id: 56, name: 'Announcements' });
    insertTopic(db, { id: 1, title: 'Validator setup guide', category_id: 57, posts_count: 10, views: 500, created_at: '2026-03-01T00:00:00.000Z', last_post_at: '2026-05-01T00:00:00.000Z' });
    insertTopic(db, { id: 2, title: 'YourChain governance proposal', category_id: 56, posts_count: 3, views: 200, created_at: '2026-02-01T00:00:00.000Z', last_post_at: '2026-04-01T00:00:00.000Z' });
    insertTopic(db, { id: 3, title: 'Network upgrade announcement', category_id: 56, posts_count: 1, views: 800, created_at: '2026-04-01T00:00:00.000Z', last_post_at: '2026-03-01T00:00:00.000Z' });
    rebuildForumFts(db);
  });

  it('returns paginated results with total', () => {
    const r = getTopics({});
    expect(r.topics.length).toBe(3);
    expect(r.total).toBe(3);
    expect(r.page).toBe(1);
    expect(r.totalPages).toBe(1);
  });

  it('respects perPage', () => {
    const r = getTopics({ perPage: 2 });
    expect(r.topics.length).toBe(2);
    expect(r.totalPages).toBe(2);
  });

  it('returns page 2', () => {
    const r = getTopics({ perPage: 2, page: 2 });
    expect(r.topics.length).toBe(1);
    expect(r.page).toBe(2);
  });

  it('includes category_name via JOIN', () => {
    const r = getTopics({});
    expect(r.topics.find(t => t.category_id === 57)?.category_name).toBe('App Development');
  });

  it('filters by category', () => {
    const r = getTopics({ category: 56 });
    expect(r.topics.length).toBe(2);
    expect(r.topics.every(t => t.category_id === 56)).toBe(true);
  });

  it('sorts by activity (last_post_at DESC) by default', () => {
    expect(getTopics({ sort: 'activity' }).topics[0].id).toBe(1);
  });

  it('sorts by most discussed', () => {
    expect(getTopics({ sort: 'discussed' }).topics[0].posts_count).toBe(10);
  });

  it('sorts by most viewed', () => {
    expect(getTopics({ sort: 'viewed' }).topics[0].views).toBe(800);
  });

  it('sorts by newest', () => {
    expect(getTopics({ sort: 'newest' }).topics[0].id).toBe(3);
  });

  it('FTS5 search finds matching topics', () => {
    const r = getTopics({ q: 'validator' });
    expect(r.topics.some(t => t.id === 1)).toBe(true);
  });

  it('FTS5 search returns empty for no match', () => {
    const r = getTopics({ q: 'zzznomatch' });
    expect(r.topics.length).toBe(0);
    expect(r.total).toBe(0);
  });
});

describe('getCategories', () => {
  beforeEach(() => {
    resetDb();
    const db = getDb();
    // getCategories() derives topic_count from forum_topics rather than
    // reading the stored column (every category here undercounted by
    // exactly 1: Discourse excludes the auto-generated "About the X
    // category" topic from its own tally while sync-forum syncs it as a
    // real row). The stored column below is deliberately WRONG - lower than
    // the real topic count - to prove the derived value is what's returned,
    // not the stale one.
    insertCategory(db, { id: 57, name: 'App Development', topic_count: 1 });
    insertCategory(db, { id: 56, name: 'Announcements', topic_count: 1 });
    insertTopic(db, { id: 1, category_id: 57 });
    insertTopic(db, { id: 2, category_id: 57 });
    insertTopic(db, { id: 3, category_id: 56 });
  });

  it('returns categories sorted by topic_count DESC', () => {
    const cats = getCategories();
    expect(cats.length).toBe(2);
    expect(cats[0].name).toBe('App Development');
  });

  it('derives topic_count from forum_topics, not the stored column', () => {
    const cats = getCategories();
    expect(cats.find(c => c.name === 'App Development')?.topic_count).toBe(2);
    expect(cats.find(c => c.name === 'Announcements')?.topic_count).toBe(1);
  });
});
