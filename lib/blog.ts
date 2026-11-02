import { BLOG_SOURCES } from './near-blogs';
import type Database from 'better-sqlite3';
import { getDb } from './db';
import { ftsPrefixMatch } from './rank';
import { snippet } from './search';

export type BlogSource = 'blog' | 'news' | 'press-release' | 'partner-news' | 'third-party';
export type BlogKind = BlogSource | 'release' | 'other';
export type BlogSort = 'newest' | 'oldest' | 'relevance';

export interface BlogTab {
  key: BlogSource;
  label: string;
  inAll: boolean;
  fullText: boolean;
}

export const BLOG_TABS: readonly BlogTab[] = [
  { key: 'blog', label: 'Blog', inAll: true, fullText: true },
  { key: 'news', label: 'News', inAll: true, fullText: true },
  { key: 'press-release', label: 'Press', inAll: true, fullText: true },
  { key: 'partner-news', label: 'Partner press', inAll: false, fullText: false },
  { key: 'third-party', label: 'Third-party', inAll: false, fullText: false },
];

export const NEWS_STUB_CHARS = 250;
export const MAX_BLOG_PAGE = 500;
export const MAX_BLOG_OFFSET = 100_000;
export const BLOG_SYNC_SOURCES = ['blog'] as const;

const TAB_BY_KEY = new Map<string, BlogTab>(BLOG_TABS.map(t => [t.key, t]));
const ALL_KINDS = BLOG_TABS.filter(t => t.inAll).map(t => t.key);

export function isBlogSource(value: string | undefined): value is BlogSource {
  return value !== undefined && TAB_BY_KEY.has(value);
}

export function kindLabel(kind: string): string {
  if (kind === 'release') return 'Release notes';
  return TAB_BY_KEY.get(kind)?.label ?? 'Post';
}

export function servesFullText(kind: string): boolean {
  return TAB_BY_KEY.get(kind)?.fullText ?? false;
}

export function parseBlogPage(raw: string | undefined): number {
  const n = parseInt(raw ?? '1', 10);
  return Number.isFinite(n) ? Math.min(Math.max(1, n), MAX_BLOG_PAGE) : 1;
}

const TAGS_SQL = `(',' || replace(coalesce(tags, ''), ', ', ',') || ',')`;
const hasTag = (tag: string): string => `instr(${TAGS_SQL}, ',${tag},') > 0`;

const FIRST_PARTY_BLOGS = BLOG_SOURCES.map((b) => `'${b.label.replace(/'/g, "''")}'`).join(', ');

export const KIND_SQL = `CASE
  WHEN coalesce(tags, '') IN (${FIRST_PARTY_BLOGS}) THEN 'blog'
  WHEN ${hasTag('third-party')} THEN 'third-party'
  WHEN ${hasTag('partner-news')} THEN 'partner-news'
  WHEN ${hasTag('release-notes')} THEN 'release'
  WHEN ${hasTag('press-release')} THEN 'press-release'
  WHEN ${hasTag('news')} THEN 'news'
  WHEN ${hasTag('blog')} THEN 'blog'
  ELSE 'other'
END`;

const POSTS_CTE = `WITH posts AS (
  SELECT rowid AS rid, id, title, excerpt, author, NULLIF(published_at, '') AS published_at, url, tags, synced_at,
         ${KIND_SQL} AS kind,
         length(coalesce(content_text, '')) AS text_len,
         ROW_NUMBER() OVER (PARTITION BY lower(title), coalesce(tags, '') ORDER BY published_at DESC, id ASC) AS dup
  FROM blog_posts
)`;

function scopeOf(source: BlogSource | undefined): { sql: string; params: string[] } {
  if (source) return { sql: 'dup = 1 AND kind = ?', params: [source] };
  const marks = ALL_KINDS.map(() => '?').join(', ');
  return {
    sql: `dup = 1 AND kind IN (${marks}) AND NOT (kind = 'news' AND text_len < ${NEWS_STUB_CHARS})`,
    params: [...ALL_KINDS],
  };
}

export function authorLabel(raw: string | null | undefined): string | null {
  const author = (raw ?? '').trim();
  if (!author) return null;
  if (/\(slack\)\s*$/i.test(author) || /\bbot\b/i.test(author)) return null;
  const paren = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(author);
  if (author.includes('@')) return paren && !paren[2].includes('@') ? paren[2].trim() : null;
  if (paren && /^[A-Z ]+$/.test(paren[2])) return paren[1].trim();
  return author;
}

export function sourceHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export function shortLine(excerpt: string | null | undefined, text: string | null | undefined, max: number = 220): string {
  const base = (excerpt ?? '').replace(/\s+/g, ' ').trim() || (text ?? '').replace(/\s+/g, ' ').trim();
  if (base.length <= max) return base;
  const cut = base.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

export interface BlogListItem {
  id: string;
  title: string;
  line: string;
  author: string | null;
  published_at: string | null;
  url: string;
  kind: BlogKind;
  label: string;
  host: string | null;
  external: boolean;
}

export interface GetBlogPostsOptions {
  source?: BlogSource;
  q?: string;
  sort?: BlogSort;
  page?: number;
  perPage?: number;
  offset?: number;
}

export interface GetBlogPostsResult {
  posts: BlogListItem[];
  total: number;
  page: number;
  totalPages: number;
}

interface ListRow {
  id: string;
  title: string;
  excerpt: string | null;
  author: string | null;
  published_at: string | null;
  url: string;
  kind: BlogKind;
  body_head: string | null;
}

function orderOf(sort: BlogSort, hasQuery: boolean): string {
  if (sort === 'oldest') return 'p.published_at IS NULL, p.published_at ASC, p.id ASC';
  if (sort === 'relevance' && hasQuery) return 'rank, p.published_at DESC, p.id ASC';
  return 'p.published_at DESC, p.id ASC';
}

export function getBlogPosts(opts: GetBlogPostsOptions, db: Database.Database = getDb()): GetBlogPostsResult {
  const page = Math.min(Math.max(1, Math.floor(opts.page ?? 1) || 1), MAX_BLOG_PAGE);
  const perPage = opts.perPage ?? 20;
  const offset = opts.offset !== undefined ? Math.min(Math.max(0, Math.floor(opts.offset) || 0), MAX_BLOG_OFFSET) : (page - 1) * perPage;
  const q = opts.q?.trim() || undefined;
  const ftsQ = q ? ftsPrefixMatch(q) : null;
  if (q && !ftsQ) return { posts: [], total: 0, page, totalPages: 1 };

  const scope = scopeOf(opts.source);
  const join = ftsQ ? 'JOIN blog_posts_fts ON blog_posts_fts.rowid = p.rid' : '';
  const where = ftsQ ? `${scope.sql} AND blog_posts_fts MATCH ?` : scope.sql;
  const params = ftsQ ? [...scope.params, ftsQ] : scope.params;

  const total = (db.prepare(`${POSTS_CTE} SELECT COUNT(*) AS c FROM posts p ${join} WHERE ${where}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `${POSTS_CTE}
     SELECT p.id, p.title, p.excerpt, p.author, p.published_at, p.url, p.kind, substr(b.content_text, 1, 2000) AS body_head
     FROM posts p JOIN blog_posts b ON b.rowid = p.rid ${join}
     WHERE ${where} ORDER BY ${orderOf(opts.sort ?? 'newest', Boolean(ftsQ))} LIMIT ? OFFSET ?`
  ).all(...params, perPage, offset) as ListRow[];

  const posts = rows.map((r): BlogListItem => {
    const external = !servesFullText(r.kind);
    return {
      id: r.id,
      title: r.title,
      line: q ? snippet(r.body_head || r.excerpt, q, 180) : shortLine(r.excerpt, r.body_head),
      author: authorLabel(r.author),
      published_at: r.published_at,
      url: r.url,
      kind: r.kind,
      label: kindLabel(r.kind),
      host: sourceHost(r.url),
      external,
    };
  });

  return { posts, total, page: Math.floor(offset / perPage) + 1, totalPages: Math.max(1, Math.ceil(total / perPage)) };
}

export interface BlogTabCounts {
  all: number;
  bySource: Record<BlogSource, number>;
}

export function getBlogTabCounts(q?: string, db: Database.Database = getDb()): BlogTabCounts {
  const ftsQ = q?.trim() ? ftsPrefixMatch(q) : null;
  const empty = Object.fromEntries(BLOG_TABS.map(t => [t.key, 0])) as Record<BlogSource, number>;
  if (q?.trim() && !ftsQ) return { all: 0, bySource: empty };
  const join = ftsQ ? 'JOIN blog_posts_fts ON blog_posts_fts.rowid = p.rid' : '';
  const match = ftsQ ? ' AND blog_posts_fts MATCH ?' : '';
  const extra = ftsQ ? [ftsQ] : [];

  const bySource = { ...empty };
  const rows = db.prepare(`${POSTS_CTE} SELECT kind, COUNT(*) AS n FROM posts p ${join} WHERE dup = 1${match} GROUP BY kind`).all(...extra) as { kind: string; n: number }[];
  for (const r of rows) if (isBlogSource(r.kind)) bySource[r.kind] = r.n;

  const all = scopeOf(undefined);
  const allCount = (db.prepare(`${POSTS_CTE} SELECT COUNT(*) AS c FROM posts p ${join} WHERE ${all.sql}${match}`).get(...all.params, ...extra) as { c: number }).c;
  return { all: allCount, bySource };
}

export interface BlogGlance {
  shown: number;
  held: number;
  newest: { id: string; title: string; published_at: string | null } | null;
  checkedAt: string | null;
}

export function getBlogGlance(db: Database.Database = getDb()): BlogGlance {
  const all = scopeOf(undefined);
  const shown = (db.prepare(`${POSTS_CTE} SELECT COUNT(*) AS c FROM posts WHERE ${all.sql}`).get(...all.params) as { c: number }).c;
  const held = (db.prepare('SELECT COUNT(*) AS c FROM blog_posts').get() as { c: number }).c;
  const newest = db.prepare(
    `${POSTS_CTE} SELECT id, title, published_at FROM posts WHERE ${all.sql} AND published_at IS NOT NULL ORDER BY published_at DESC, id ASC LIMIT 1`
  ).get(...all.params) as BlogGlance['newest'] | undefined;
  const marks = BLOG_SYNC_SOURCES.map(() => '?').join(', ');
  const checked = db.prepare(
    `SELECT MAX(ran_at) AS ran FROM sync_log WHERE source IN (${marks}) AND status IN ('success', 'partial')`
  ).get(...BLOG_SYNC_SOURCES) as { ran: string | null } | undefined;
  return { shown, held, newest: newest ?? null, checkedAt: checked?.ran ?? null };
}

export interface BlogPost {
  id: string;
  title: string;
  excerpt: string | null;
  author: string | null;
  published_at: string | null;
  url: string;
  tags: string | null;
  synced_at: string;
  kind: BlogKind;
  content_text: string | null;
  content_html: string | null;
}

export function getBlogPost(id: string, db: Database.Database = getDb()): BlogPost | null {
  const row = db.prepare(
    `SELECT id, title, excerpt, author, published_at, url, tags, synced_at, content_text, content_html, ${KIND_SQL} AS kind
     FROM blog_posts WHERE id = ?`
  ).get(id) as BlogPost | undefined;
  return row ?? null;
}
