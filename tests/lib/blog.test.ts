import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '@/lib/db';
import { logRun } from '@/lib/sync-log';
import {
  authorLabel, getBlogGlance, getBlogPost, getBlogPosts, getBlogTabCounts, isBlogSource, kindLabel, parseBlogPage,
  servesFullText, shortLine, sourceHost,
} from '@/lib/blog';

const NOW = new Date().toISOString();
const LONG = 'A body with enough words to count as an article rather than a headline. '.repeat(8);

function seedPost(id: string, title: string, tags: string, published_at: string, opts: { text?: string; author?: string; excerpt?: string; url?: string } = {}) {
  getDb().prepare(
    'INSERT INTO blog_posts (id, title, excerpt, content_text, author, published_at, url, tags, synced_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(id, title, opts.excerpt ?? '', opts.text ?? LONG, opts.author ?? 'author', published_at, opts.url ?? `https://example.com/${id}`, tags, NOW);
}

describe('getBlogPosts, the default list', () => {
  beforeEach(() => { resetDb(); });

  it('shows first-party writing and leaves out release notes, partner press and reprints', () => {
    seedPost('b1', 'Blog Post', 'blog', '2026-01-01T00:00:00Z');
    seedPost('n1', 'News Post', 'news', '2026-01-02T00:00:00Z');
    seedPost('p1', 'Press Post', 'press-release', '2026-01-03T00:00:00Z');
    seedPost('r1', 'Release Notes', 'release-notes', '2026-01-06T00:00:00Z');
    seedPost('w1', 'Partner announcement', 'partner-news', '2026-01-08T00:00:00Z');
    seedPost('t1', 'Reprint', 'third-party,aggregator', '2026-01-09T00:00:00Z');
    const ids = getBlogPosts({}).posts.map(p => p.id).sort();
    expect(ids).toEqual(['b1', 'n1', 'p1']);
  });

  it('reads a tag as a whole word, so myblog is not a blog post and a reprint tagged news is not news', () => {
    seedPost('m1', 'Other', 'myblog', '2026-01-05T00:00:00Z');
    seedPost('t1', 'Reprint', 'third-party,news', '2026-01-07T00:00:00Z');
    expect(getBlogPosts({ source: 'blog' }).posts).toEqual([]);
    expect(getBlogPosts({ source: 'news' }).posts).toEqual([]);
    expect(getBlogPosts({ source: 'third-party' }).posts.map(p => p.id)).toEqual(['t1']);
  });

  it('keeps short news headlines out of the default list and in the News tab', () => {
    seedPost('n1', 'Headline only', 'news', '2026-01-02T00:00:00Z', { text: 'Short.' });
    seedPost('n2', 'Headline with no text', 'news', '2026-01-03T00:00:00Z', { text: '' });
    seedPost('n3', 'Real news', 'news', '2026-01-04T00:00:00Z');
    expect(getBlogPosts({}).posts.map(p => p.id)).toEqual(['n3']);
    expect(getBlogPosts({ source: 'news' }).posts.map(p => p.id).sort()).toEqual(['n1', 'n2', 'n3']);
  });

  it('lists one post for a title that was collected twice and keeps the newest', () => {
    seedPost('a1', 'Same story', 'news', '2026-01-02T00:00:00Z');
    seedPost('a2', 'Same story', 'news', '2026-01-05T00:00:00Z');
    seedPost('a3', 'Same story', 'blog', '2026-01-03T00:00:00Z');
    const ids = getBlogPosts({}).posts.map(p => p.id).sort();
    expect(ids).toEqual(['a2', 'a3']);
  });

  it('paginates and sorts newest first', () => {
    for (let i = 1; i <= 25; i++) seedPost(`b${i}`, `Post ${i}`, 'blog', `2026-01-${String(i).padStart(2, '0')}T00:00:00Z`);
    const { posts, total, totalPages } = getBlogPosts({ page: 1, perPage: 20 });
    expect(posts).toHaveLength(20);
    expect(total).toBe(25);
    expect(totalPages).toBe(2);
    expect(posts[0].id).toBe('b25');
  });

  it('answers an offset far past the end, or too large for SQLite, with an empty page', () => {
    seedPost('b1', 'Blog Post', 'blog', '2026-01-01T00:00:00Z');
    expect(getBlogPosts({ offset: 50 }).posts).toEqual([]);
    expect(getBlogPosts({ offset: 1e23 })).toMatchObject({ posts: [], total: 1 });
  });

  it('does not fail on a page that is not a number', () => {
    seedPost('b1', 'Blog Post', 'blog', '2026-01-01T00:00:00Z');
    expect(getBlogPosts({ page: Number.NaN }).posts).toHaveLength(1);
    expect(getBlogPosts({ page: -4 }).posts).toHaveLength(1);
  });

  it('labels each post, hides bot and e-mail authors and marks what is served as an excerpt', () => {
    seedPost('b1', 'Blog Post', 'blog', '2026-01-07T00:00:00Z', { author: 'Release bot (Slack)', url: 'https://workspace.slack.com/x' });
    seedPost('t1', 'Reprint', 'third-party,aggregator', '2026-01-09T00:00:00Z', { author: 'Some Wire', url: 'https://www.example.org/story' });
    seedPost('w1', 'Partner', 'partner-news', '2026-01-05T00:00:00Z', { author: 'marketing@example.com (Example Corp)' });
    const by = Object.fromEntries([...getBlogPosts({ source: 'blog' }).posts, ...getBlogPosts({ source: 'third-party' }).posts, ...getBlogPosts({ source: 'partner-news' }).posts].map(p => [p.id, p]));
    expect(by.b1).toMatchObject({ label: 'Blog', author: null, external: false });
    expect(by.t1).toMatchObject({ label: 'Third-party', author: 'Some Wire', host: 'example.org', external: true });
    expect(by.w1).toMatchObject({ label: 'Partner press', author: 'Example Corp', external: true });
  });
});

describe('getBlogPosts, ordering', () => {
  beforeEach(() => { resetDb(); });

  it('folds a title that was collected twice and counts it once', () => {
    seedPost('n1', 'Same story', 'news', '2026-01-02T00:00:00Z');
    seedPost('n2', 'Same story', 'news', '2026-01-03T00:00:00Z');
    expect(getBlogTabCounts().bySource).toMatchObject({ news: 1 });
  });

  it('puts a post with an empty date last under oldest first and reports it as undated', () => {
    seedPost('b1', 'Dated', 'blog', '2026-01-01T00:00:00Z');
    seedPost('b2', 'Undated', 'blog', '');
    const oldest = getBlogPosts({ sort: 'oldest' }).posts;
    expect(oldest.map(p => p.id)).toEqual(['b1', 'b2']);
    expect(oldest[1].published_at).toBeNull();
  });

  it('orders a search by relevance and pages from an offset that is not a multiple of the page size', () => {
    seedPost('b1', 'Quorum', 'blog', '2026-01-01T00:00:00Z', { text: `${LONG} quorum quorum quorum quorum` });
    seedPost('b2', 'Other', 'blog', '2026-02-01T00:00:00Z', { text: `${LONG} quorum` });
    for (let i = 0; i < 5; i++) seedPost(`c${i}`, `Filler ${i}`, 'blog', `2026-03-0${i + 1}T00:00:00Z`);
    expect(getBlogPosts({ q: 'quorum', sort: 'relevance' }).posts[0].id).toBe('b1');
    const all = getBlogPosts({ perPage: 50 }).posts.map(p => p.id);
    expect(getBlogPosts({ offset: 3, perPage: 2 }).posts.map(p => p.id)).toEqual(all.slice(3, 5));
  });
});

describe('getBlogPosts search', () => {
  beforeEach(() => { resetDb(); });

  it('finds a post by what it says and returns the passage around the word', () => {
    seedPost('b1', 'Quiet title', 'blog', '2026-01-01T00:00:00Z', { text: `${LONG} The vetting of packages changed this quarter. ${LONG}` });
    seedPost('b2', 'Other', 'blog', '2026-01-02T00:00:00Z');
    const { posts, total } = getBlogPosts({ q: 'vetting' });
    expect(total).toBe(1);
    expect(posts[0].id).toBe('b1');
    expect(posts[0].line.toLowerCase()).toContain('vetting');
  });

  it('keeps the scope when searching, so a reprint is found in its own tab only', () => {
    seedPost('t1', 'Reprint about vetting', 'third-party', '2026-01-01T00:00:00Z');
    expect(getBlogPosts({ q: 'vetting' }).total).toBe(0);
    expect(getBlogPosts({ q: 'vetting', source: 'third-party' }).total).toBe(1);
  });

  it('returns nothing for a query with no searchable word', () => {
    seedPost('b1', 'Blog Post', 'blog', '2026-01-01T00:00:00Z');
    expect(getBlogPosts({ q: '!!!' })).toMatchObject({ posts: [], total: 0 });
  });
});

describe('getBlogTabCounts and getBlogGlance', () => {
  beforeEach(() => { resetDb(); });

  it('counts every tab, and All is what the default list shows', () => {
    seedPost('b1', 'Blog Post', 'blog', '2026-01-01T00:00:00Z');
    seedPost('n1', 'Headline', 'news', '2026-01-02T00:00:00Z', { text: '' });
    seedPost('t1', 'Reprint', 'third-party', '2026-01-03T00:00:00Z');
    seedPost('r1', 'Release', 'release-notes', '2026-01-04T00:00:00Z');
    const counts = getBlogTabCounts();
    expect(counts.all).toBe(1);
    expect(counts.bySource).toMatchObject({ blog: 1, news: 1, 'third-party': 1, 'partner-news': 0 });
  });

  it('narrows the counts to a search', () => {
    seedPost('b1', 'Alpha story', 'blog', '2026-01-01T00:00:00Z');
    seedPost('b2', 'Beta story', 'blog', '2026-01-02T00:00:00Z');
    expect(getBlogTabCounts('alpha')).toMatchObject({ all: 1, bySource: { blog: 1 } });
    expect(getBlogTabCounts('!!!').all).toBe(0);
  });

  it('reports the newest post of All, how many items are held in all and when the syncs last ran', () => {
    seedPost('b1', 'Old', 'blog', '2026-01-01T00:00:00Z');
    seedPost('b2', 'New', 'blog', '2026-03-01T00:00:00Z');
    seedPost('t1', 'Newer reprint', 'third-party', '2026-05-01T00:00:00Z');
    logRun('blog', { status: 'success', items: 3 });
    const glance = getBlogGlance();
    expect(glance.shown).toBe(2);
    expect(glance.held).toBe(3);
    expect(glance.newest?.id).toBe('b2');
    expect(glance.checkedAt).not.toBeNull();
  });
});

describe('getBlogPost', () => {
  beforeEach(() => { resetDb(); });

  it('returns the full row with its kind', () => {
    seedPost('t1', 'Reprint', 'third-party,aggregator', '2026-01-03T00:00:00Z');
    expect(getBlogPost('t1')).toMatchObject({ id: 't1', kind: 'third-party' });
    expect(getBlogPost('missing')).toBeNull();
  });
});

describe('helpers', () => {
  it('reads author names the way a reader expects', () => {
    expect(authorLabel('Example Corp')).toBe('Example Corp');
    expect(authorLabel('Release bot (Slack)')).toBeNull();
    expect(authorLabel('Operations (Slack)')).toBeNull();
    expect(authorLabel('marketing@example.com (Example Corp)')).toBe('Example Corp');
    expect(authorLabel('jane.doe@example.com (Jane Doe)')).toBe('Jane Doe');
    expect(authorLabel('someone@example.com')).toBeNull();
    expect(authorLabel('PR Newswire (NEW YORK)')).toBe('PR Newswire');
    expect(authorLabel('')).toBeNull();
    expect(authorLabel(null)).toBeNull();
  });

  it('names the host of a link without www and survives a bad one', () => {
    expect(sourceHost('https://www.example.org/news-releases/x.html')).toBe('example.org');
    expect(sourceHost('not a url')).toBeNull();
    expect(sourceHost(null)).toBeNull();
  });

  it('shortens a line on a word and falls back to the text when there is no excerpt', () => {
    expect(shortLine('Short.', 'ignored')).toBe('Short.');
    expect(shortLine('', 'From the body text')).toBe('From the body text');
    const long = shortLine('', 'word '.repeat(100), 60);
    expect(long.endsWith('…')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(61);
  });

  it('parses a page and a source the way the route needs', () => {
    expect(parseBlogPage('abc')).toBe(1);
    expect(parseBlogPage('0')).toBe(1);
    expect(parseBlogPage('7')).toBe(7);
    expect(parseBlogPage('999999')).toBe(500);
    expect(isBlogSource('partner-news')).toBe(true);
    expect(isBlogSource('bogus')).toBe(false);
    expect(isBlogSource(undefined)).toBe(false);
  });

  it('knows which kinds are served as full text', () => {
    expect(servesFullText('blog')).toBe(true);
    expect(servesFullText('news')).toBe(true);
    expect(servesFullText('third-party')).toBe(false);
    expect(servesFullText('other')).toBe(false);
    expect(servesFullText('release')).toBe(false);
    expect(servesFullText('partner-news')).toBe(false);
    expect(kindLabel('partner-news')).toBe('Partner press');
    expect(kindLabel('release')).toBe('Release notes');
  });
});
