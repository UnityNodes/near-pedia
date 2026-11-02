import Fuse from 'fuse.js';
import { getDb } from './db';
import { tokenize, scoreResult } from './rank';
import { radarLiveSql } from './constants';

export type SearchResultType = 'discussion' | 'doc' | 'youtube' | 'github' | 'blog';

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  excerpt: string;
  url: string;
  meta?: string;
  /** The page upstream (gov.near.org, docs.near.org, the post itself), where url is this site's page for it. */
  source_url?: string;
  /** What the row is when its type is a coarser bucket: release, radar, project. */
  label?: string;
}

export interface UnifiedSearchResult {
  results: SearchResult[];
  total: number;
}

function truncate(text: string | null | undefined, max = 160): string {
  if (!text) return '';
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

export function snippet(text: string | null | undefined, query: string, max = 200): string {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  const words = query.trim().split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return clean.slice(0, max) + (clean.length > max ? '…' : '');

  const re = new RegExp(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
  const idx = clean.search(re);
  if (idx === -1) return clean.slice(0, max) + (clean.length > max ? '…' : '');

  const start = Math.max(0, idx - 60);
  // A fixed window cut mid-URL leaves a dangling "https://github.com…" that
  // looks like a real, truncated link rather than an excerpt boundary - a
  // reader or an agent has no way to tell the two apart. check-citations
  // caught this on a "discussions-to" frontmatter field. Extend the
  // window to the next whitespace when the raw cut point lands inside a
  // run of non-space characters, capped so one link-free run of text can't
  // grow the window unboundedly.
  let end = Math.min(clean.length, idx + max - 60);
  if (end < clean.length && !/\s/.test(clean[end - 1] ?? '') && !/\s/.test(clean[end] ?? '')) {
    const nextSpace = clean.indexOf(' ', end);
    // 200, not something tighter: a GitHub blob URL with a commit SHA in
    // the path ("…/blob/2854ee0132ba4d…/x/blob/README.md") routinely runs
    // well past 100 characters on its own.
    if (nextSpace !== -1 && nextSpace - end < 200) end = nextSpace;
  }
  const result = clean.slice(start, end);
  return (start > 0 ? '…' : '') + result + (end < clean.length ? '…' : '');
}

function getBlogInternalUrl(id: string, tags: string | null): string {
  const tag = tags?.split(',')[0] ?? '';
  if (tag === 'release-notes') return `/releases/${id}`;
  return `/blog/${id}`;
}

type DbLike = ReturnType<typeof getDb>;

export function unifiedSearch(q: string, _limit = 50, dbOverride?: DbLike): UnifiedSearchResult {
  if (!q.trim()) return { results: [], total: 0 };

  const db = dbOverride ?? getDb();
  const results: SearchResult[] = [];
  // Strip FTS5-special chars so user input can't be parsed as operators or
  // column filters, and REPLACE them with a space rather than deleting them.
  // Two separate bugs this guards against:
  //   ':'  -> FTS5 read "foo:bar" as a column filter on a non-existent column.
  //   '-'  -> FTS5 read "NEP-141" as the NOT operator, so every hyphenated
  //           NEAR term (NEP-141, near-api-js) threw and the catch
  //           blocks below swallowed it: the whole FTS layer returned nothing.
  // Deleting would fuse the halves ("NEP141"); a space keeps both tokens.
  const ftsQ = q.trim()
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => `${w}*`)
    .join(' ');

  try {
    const topics = db.prepare(`
      SELECT t.id, t.title, t.url, t.last_post_at,
        (SELECT cooked FROM forum_posts WHERE topic_id = t.id ORDER BY post_number LIMIT 1) as first_post
      FROM forum_topics t
      JOIN forum_fts ON t.id = forum_fts.rowid
      WHERE forum_fts MATCH ?
      ORDER BY rank
      LIMIT 10
    `).all(ftsQ) as { id: number; title: string; url: string; last_post_at: string | null; first_post: string | null }[];

    for (const t of topics) {
      const rawText = t.first_post?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
      results.push({
        type: 'discussion',
        id: String(t.id),
        title: t.title,
        excerpt: snippet(rawText, q),
        url: `/discussions/${t.id}`,
        source_url: t.url,
        meta: t.last_post_at ? `forum · last post ${t.last_post_at.slice(0, 10)}` : 'forum',
      });
    }
  } catch (e) { console.warn('[search] FTS block failed:', e instanceof Error ? e.message : e); }

  try {
    const docs = db.prepare(`
      SELECT d.id, d.title, d.breadcrumb, d.excerpt, d.content_text, d.source, d.url
      FROM doc_pages d
      JOIN docs_fts ON d.id = docs_fts.rowid
      WHERE docs_fts MATCH ?
      ORDER BY rank
      LIMIT 10
    `).all(ftsQ) as { id: number; title: string; breadcrumb: string; excerpt: string; content_text: string; source: string; url: string }[];

    for (const d of docs) {
      results.push({
        type: 'doc',
        id: String(d.id),
        title: d.title ?? '',
        excerpt: snippet(d.content_text || d.excerpt, q),
        url: `/docs/${d.id}`,
        meta: d.source,
        source_url: d.url,
      });
    }
  } catch (e) { console.warn('[search] FTS block failed:', e instanceof Error ? e.message : e); }

  try {
    const videos = db.prepare(`
      SELECT v.id, v.title, v.description, v.transcript_text, v.published_at, v.channel_name, v.url
      FROM youtube_videos v
      JOIN youtube_videos_fts ON v.rowid = youtube_videos_fts.rowid
      WHERE youtube_videos_fts MATCH ?
      ORDER BY rank
      LIMIT 5
    `).all(ftsQ) as {
      id: string; title: string; description: string | null; transcript_text: string | null;
      published_at: string; channel_name: string | null; url: string;
    }[];

    for (const v of videos) {
      // Prefer transcript snippet when the query word lives there - the description
      // is usually a generic blurb. Fall back to description if the word isn't in the
      // transcript (matched title-only) or there is no transcript yet.
      const ql = q.trim().toLowerCase();
      const fromTranscript =
        v.transcript_text && ql && v.transcript_text.toLowerCase().includes(ql)
          ? snippet(v.transcript_text, q)
          : null;
      const meta = [v.channel_name, v.published_at?.slice(0, 10)].filter(Boolean).join(' · ');
      results.push({
        type: 'youtube',
        id: v.id,
        title: v.title,
        excerpt: fromTranscript ?? snippet(v.description ?? '', q),
        url: v.url,
        meta,
      });
    }
  } catch (e) { console.warn('[search] FTS block failed:', e instanceof Error ? e.message : e); }

  try {
    const nd = likeNeedles(q);
    const { sql: ndSql, args: ndArgs } = likeClause(nd, ['title', 'body']);
    const items = nd.length === 0 ? [] : db.prepare(`
      SELECT id, type, repo, number, title, body, state, url
      FROM github_items
      WHERE ${ndSql}
      ORDER BY created_at DESC
      LIMIT 5
    `).all(...ndArgs) as { id: string; type: string; repo: string; number: number; title: string; body: string; state: string; url: string }[];

    for (const g of items) {
      results.push({
        type: 'github',
        id: g.id,
        title: g.title,
        excerpt: snippet(g.body, q),
        url: g.url,
        meta: `${g.repo} · ${g.type} #${g.number} · ${g.state}`,
      });
    }
  } catch { /* table not ready */ }

  try {
    const posts = db.prepare(`
      SELECT b.id, b.title, b.excerpt, b.content_text, b.author, b.published_at, b.url, b.tags
      FROM blog_posts b
      JOIN blog_posts_fts ON b.rowid = blog_posts_fts.rowid
      WHERE blog_posts_fts MATCH ? AND instr(',' || replace(coalesce(b.tags, ''), ', ', ',') || ',', ',release-notes,') = 0
      ORDER BY rank
      LIMIT 8
    `).all(ftsQ) as { id: string; title: string; excerpt: string; content_text: string | null; author: string; published_at: string; url: string; tags: string | null }[];

    for (const b of posts) {
      results.push({
        type: 'blog',
        id: b.id,
        title: b.title,
        excerpt: snippet(b.content_text || b.excerpt, q),
        // third-party news (e.g. an external NEAR news outlet) links to its external source, not
        // an internal /blog page - we index it for search/RAG, we don't re-host.
        url: b.tags?.includes('third-party') ? b.url : getBlogInternalUrl(b.id, b.tags),
        meta: [b.author, b.published_at?.slice(0, 10)].filter(Boolean).join(' · '),
        source_url: b.url,
      });
    }
  } catch (e) { console.warn('[search] FTS block failed:', e instanceof Error ? e.message : e); }

  // GitHub Releases
  try {
    const nd = likeNeedles(q);
    const { sql: ndSql, args: ndArgs } = likeClause(nd, ['name', 'tag', 'body']);
    const releases = nd.length === 0 ? [] : db.prepare(`
      SELECT id, repo, tag, name, body, published_at, url
      FROM github_releases
      WHERE ${ndSql}
      ORDER BY published_at DESC LIMIT 5
    `).all(...ndArgs) as { id: string; repo: string; tag: string; name: string | null; body: string | null; published_at: string | null; url: string }[];
    for (const r of releases) {
      results.push({
        type: 'github',
        id: r.id,
        title: r.name ?? r.tag,
        excerpt: snippet(r.body, q),
        url: r.url,
        meta: `${r.repo} · release · ${r.published_at?.slice(0, 10) ?? ''}`,
        label: 'release',
      });
    }
  } catch { /* table not ready */ }

  // Radar Items
  try {
    const nd = likeNeedles(q);
    const { sql: ndSql, args: ndArgs } = likeClause(nd, ['title', 'body']);
    const radars = nd.length === 0 ? [] : db.prepare(`
      SELECT id, title, body, source_url, level, published_at
      FROM radar_items
      WHERE (${ndSql}) AND ${radarLiveSql()}
      ORDER BY published_at DESC LIMIT 5
    `).all(...ndArgs) as { id: number; title: string; body: string | null; source_url: string | null; level: string; published_at: string }[];
    for (const r of radars) {
      results.push({
        type: 'github',
        id: String(r.id),
        title: `[${r.level.toUpperCase()}] ${r.title}`,
        excerpt: snippet(r.body, q),
        url: r.source_url ?? '/radar',
        meta: `radar · ${r.published_at?.slice(0, 10) ?? ''}`,
        label: 'radar',
      });
    }
  } catch { /* table not ready */ }

  // Ecosystem Projects
  try {
    const nd = likeNeedles(q);
    const { sql: ndSql, args: ndArgs } = likeClause(nd, ['title', 'description']);
    const eco = nd.length === 0 ? [] : db.prepare(`
      SELECT slug, title, description, url, category
      FROM ecosystem_projects
      WHERE ${ndSql}
      ORDER BY slug ASC
      LIMIT 5
    `).all(...ndArgs) as { slug: string; title: string; description: string | null; url: string; category: string | null }[];
    for (const e of eco) {
      results.push({
        type: 'github',
        id: e.slug,
        title: e.title,
        excerpt: truncate(e.description, 200),
        url: e.url,
        meta: e.category ?? 'ecosystem',
        label: 'project',
      });
    }
  } catch { /* table not ready */ }

  // GitHub Discussions
  try {
    const nd = likeNeedles(q);
    const { sql: ndSql, args: ndArgs } = likeClause(nd, ['title', 'body']);
    const discussions = nd.length === 0 ? [] : db.prepare(`
      SELECT id, repo, number, title, body, category, author, created_at, url, upvotes, answered
      FROM github_discussions
      WHERE ${ndSql}
      ORDER BY upvotes DESC, created_at DESC LIMIT 5
    `).all(...ndArgs) as { id: string; repo: string; number: number; title: string; body: string | null; category: string | null; author: string | null; created_at: string | null; url: string; upvotes: number; answered: number }[];
    for (const d of discussions) {
      results.push({
        type: 'discussion',
        id: d.id,
        title: d.answered ? `✓ ${d.title}` : d.title,
        excerpt: snippet(d.body, q),
        url: d.url,
        meta: [d.repo, d.category, d.author].filter(Boolean).join(' · '),
      });
    }
  } catch { /* table not ready */ }

  // Enough real hits - skip the fuzzy fallback, but still interleave.
  if (results.length >= 3) return { results: interleaveByType(results, q, db), total: results.length };

  const fuzzy = fuzzyFallback(q, db);
  const existingIds = new Set(results.map(r => `${r.type}:${r.id}`));
  for (const r of fuzzy) {
    if (!existingIds.has(`${r.type}:${r.id}`)) results.push(r);
  }

  return { results: interleaveByType(results, q, db), total: results.length };
}

/**
 * Blocks are collected source-by-source, so the flat list is
 * [13 discussions, 10 docs, 8 blog posts, ...]. Callers slice it (`limit`
 * defaults to 10 on the MCP `search` tool), which meant every result after
 * the first source was structurally unreachable: "upgrade" returned 10 of
 * one kind and nothing else even though docs, blog posts and videos had
 * matched.
 *
 * Round-robin across types so any prefix of the list is a mix. Within a type
 * the original per-source order (FTS `rank`) is preserved, so this reorders
 * without pretending to be a cross-type relevance score - a real reranker
 * (idf-weighted) is the proper fix and is not implemented here.
 */
function interleaveByType(results: SearchResult[], q: string, db: DbLike): SearchResult[] {
  if (results.length < 2) return results;

  // Rank within each type by idf relevance (title hits weighted over body),
  // then round-robin across types. Sorting inside the bucket is what makes the
  // round-robin honest: position i of each list is that type's i-th best, so
  // any prefix is "the best of each kind" rather than "whatever the retrieval
  // block happened to emit first".
  const qTokens = [...new Set(tokenize(q))];
  const buckets = new Map<string, { r: SearchResult; s: number }[]>();
  for (const r of results) {
    const s = scoreResult(db, qTokens, r.title, r.excerpt, `${r.id} ${r.meta ?? ""}`);
    const b = buckets.get(r.type);
    if (b) b.push({ r, s }); else buckets.set(r.type, [{ r, s }]);
  }

  const lists: SearchResult[][] = [];
  let bestOverall: { r: SearchResult; s: number } | null = null;
  for (const b of buckets.values()) {
    b.sort((x, y) => y.s - x.s);
    if (!bestOverall || b[0].s > bestOverall.s) bestOverall = b[0];
    lists.push(b.map(x => x.r));
  }

  const out: SearchResult[] = [];
  for (let i = 0; out.length < results.length; i++) {
    for (const list of lists) if (i < list.length) out.push(list[i]);
  }

  // The single best-scoring result leads, whatever its type - otherwise an
  // exact title match could be pushed below a weak hit from an earlier bucket.
  if (bestOverall && out[0] !== bestOverall.r) {
    const i = out.indexOf(bestOverall.r);
    if (i > 0) { out.splice(i, 1); out.unshift(bestOverall.r); }
  }
  return out;
}

/** Escape LIKE wildcards so a user's '%' cannot turn into a full-scan match. */
function escLike(s: string): string {
  return s.replace(/[\\%_]/g, m => '\\' + m);
}

// '%i%' matches 1250 of 1254 github_items rows: as a LIKE conjunct it filters
// nothing, drags in unrelated rows and drives the p95 tail. FTS still scores
// these tokens - this list only gates the LIKE sources.
const LIKE_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'be',
  'do', 'does', 'how', 'what', 'why', 'when', 'where', 'i', 'we', 'you', 'it',
  'my', 'me', 'can', 'with', 'from', 'by', 'at', 'as', 'that', 'this',
]);

/**
 * Needles for the LIKE sources: discriminative tokens only, plus any
 * version-like literal from the raw query ("0.6.12" must survive as a
 * substring - splitting it into 0/6/12 matches junk like "Bump ... 12 updates").
 *
 * Returns [] when nothing is discriminative (e.g. "how do I"), so we leave that
 * query to FTS instead of scanning every table with useless conjuncts.
 */
function likeNeedles(q: string): string[] {
  const versions = [...q.matchAll(/\d+\.\d+(?:\.\d+)*/g)].map(m => m[0]);
  const tokens = (q.toLowerCase().match(/[a-z0-9][a-z0-9._-]*/g) ?? [])
    .filter(t => t.length >= 3 && !LIKE_STOPWORDS.has(t));
  return [...new Set([...versions, ...tokens])].slice(0, 6);
}

/**
 * AND the needles across the given columns. Previously every LIKE source
 * demanded the WHOLE query as one literal substring, so "node upgrade"
 * matched 0 github_items even though both words occur constantly.
 */
function likeClause(needles: string[], cols: string[]): { sql: string; args: string[] } {
  const sql = needles.map(() => `(${cols.map(c => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`).join(' AND ');
  const args = needles.flatMap(t => cols.map(() => `%${escLike(t)}%`));
  return { sql, args };
}

function fuzzyFallback(q: string, db: ReturnType<typeof getDb>): SearchResult[] {
  const results: SearchResult[] = [];

  try {
    const topics = db.prepare(
      'SELECT id, title, url FROM forum_topics WHERE title IS NOT NULL ORDER BY last_post_at DESC LIMIT 3000'
    ).all() as { id: number; title: string; url: string }[];

    const fuse = new Fuse(topics, {
      keys: ['title'],
      threshold: 0.4,
      minMatchCharLength: 3,
    });
    for (const r of fuse.search(q, { limit: 5 })) {
      results.push({
        type: 'discussion', id: String(r.item.id),
        title: r.item.title, excerpt: '',
        url: `/discussions/${r.item.id}`,
        source_url: r.item.url,
      });
    }
  } catch { /* skip */ }

  try {
    const posts = db.prepare(
      'SELECT id, title, excerpt, author, published_at, tags FROM blog_posts WHERE title IS NOT NULL ORDER BY published_at DESC LIMIT 3000'
    ).all() as { id: string; title: string; excerpt: string; author: string; published_at: string; tags: string | null }[];

    const fuse = new Fuse(posts, {
      keys: [{ name: 'title', weight: 2 }, { name: 'excerpt', weight: 1 }],
      threshold: 0.4,
      minMatchCharLength: 3,
    });
    for (const r of fuse.search(q, { limit: 5 })) {
      results.push({
        type: 'blog', id: r.item.id,
        title: r.item.title,
        excerpt: truncate(r.item.excerpt),
        url: getBlogInternalUrl(r.item.id, r.item.tags),
        meta: [r.item.author, r.item.published_at?.slice(0, 10)].filter(Boolean).join(' · '),
      });
    }
  } catch { /* skip */ }

  return results;
}
