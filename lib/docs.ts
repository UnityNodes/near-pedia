import { getDb } from './db';
import { ftsPrefixMatch } from './rank';
import { titleCaseSlug } from './utils';

export const DOC_SOURCE_LABELS: Record<string, string> = {
  docs: 'docs.near.org',
  nomicon: 'Nomicon',
  'partner-docs': 'Partner docs',
};

export function docHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export function docSourceLabel(source: string, url?: string | null): string {
  return DOC_SOURCE_LABELS[source] ?? docHost(url) ?? titleCaseSlug(source);
}

export type DocSort = 'relevance' | 'updated' | 'title';

export interface DocPage {
  id: number;
  url: string;
  title: string | null;
  breadcrumb: string | null;
  excerpt: string | null;
  source: string;
  environment: string | null;
  last_modified: string | null;
}

export interface GetDocsOptions {
  q?: string;
  source?: string;
  sources?: { include?: readonly string[]; exclude?: readonly string[] };
  sort?: DocSort;
  page?: number;
  perPage?: number;
}

export interface DocHit extends DocPage {
  body_head?: string | null;
}

export interface GetDocsResult {
  docs: DocHit[];
  total: number;
  page: number;
  totalPages: number;
}

const ENV_DEDUP_FILTER = `
  (d.environment IS NULL OR d.environment = 'releases'
   OR d.environment = 'mainnet'
   OR (d.environment = 'devnet' AND NOT EXISTS (
     SELECT 1 FROM doc_pages m WHERE m.environment = 'mainnet'
     AND m.url = REPLACE(d.url, '/devnet/', '/mainnet/')
   ))
   OR (d.environment = 'testnet' AND NOT EXISTS (
     SELECT 1 FROM doc_pages m WHERE m.environment = 'mainnet'
     AND m.url = REPLACE(d.url, '/testnet/', '/mainnet/')
   ) AND NOT EXISTS (
     SELECT 1 FROM doc_pages m WHERE m.environment = 'devnet'
     AND m.url = REPLACE(d.url, '/testnet/', '/devnet/')
   ))
  )
`;

export const MAX_PAGE = 100_000;
const TITLE_FILTER = `AND d.title IS NOT NULL AND TRIM(d.title) != ''`;
const DEDUP_CLAUSE = `AND ${ENV_DEDUP_FILTER}`;
const RELEVANCE_ORDER = 'bm25(docs_fts, 5.0, 2.0, 1.0), d.id';
const UPDATED_ORDER = `(d.last_modified IS NULL OR d.last_modified = '') ASC, d.last_modified DESC, d.title COLLATE NOCASE ASC, d.id`;
const TITLE_ORDER = `(substr(d.title, 1, 1) GLOB '[A-Za-z]') DESC, d.title COLLATE NOCASE ASC, d.id`;

function sourceClause(opts: Pick<GetDocsOptions, 'source' | 'sources'>): { sql: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  if (opts.source) { parts.push('d.source = ?'); params.push(opts.source); }
  const include = opts.sources?.include;
  if (include) {
    parts.push(include.length ? `d.source IN (${include.map(() => '?').join(', ')})` : '0');
    params.push(...include);
  }
  const exclude = opts.sources?.exclude;
  if (exclude?.length) {
    parts.push(`d.source NOT IN (${exclude.map(() => '?').join(', ')})`);
    params.push(...exclude);
  }
  return { sql: parts.map(p => `AND ${p}`).join(' '), params };
}

export function getDocs(opts: GetDocsOptions): GetDocsResult {
  const db = getDb();
  const page = Math.min(Math.max(1, Math.floor(opts.page ?? 1)), MAX_PAGE);
  const perPage = opts.perPage ?? 30;
  const offset = (page - 1) * perPage;
  const src = sourceClause(opts);
  const empty = { docs: [], total: 0, page, totalPages: 1 };

  if (opts.q && opts.q.trim()) {
    const ftsQ = ftsPrefixMatch(opts.q);
    if (!ftsQ) return empty;
    const order = opts.sort === 'updated' ? UPDATED_ORDER : RELEVANCE_ORDER;
    const from = `FROM doc_pages d JOIN docs_fts ON d.id = docs_fts.rowid WHERE docs_fts MATCH ? ${src.sql} ${TITLE_FILTER} ${DEDUP_CLAUSE}`;
    const countRow = db.prepare(`SELECT COUNT(*) as count ${from}`).get(ftsQ, ...src.params) as { count: number };
    const docs = db.prepare(
      `SELECT d.id, d.url, d.title, d.breadcrumb, d.excerpt, d.source, d.environment, d.last_modified, substr(d.content_text, 1, 2000) AS body_head ${from} ORDER BY ${order} LIMIT ? OFFSET ?`
    ).all(ftsQ, ...src.params, perPage, offset) as DocHit[];
    return { docs, total: countRow.count, page, totalPages: Math.max(1, Math.ceil(countRow.count / perPage)) };
  }

  const order = opts.sort === 'title' ? TITLE_ORDER : UPDATED_ORDER;
  const from = `FROM doc_pages d WHERE 1=1 ${src.sql} ${TITLE_FILTER} ${DEDUP_CLAUSE}`;
  const countRow = db.prepare(`SELECT COUNT(*) as count ${from}`).get(...src.params) as { count: number };
  const docs = db.prepare(
    `SELECT d.id, d.url, d.title, d.breadcrumb, d.excerpt, d.source, d.environment, d.last_modified ${from} ORDER BY ${order} LIMIT ? OFFSET ?`
  ).all(...src.params, perPage, offset) as DocHit[];
  return { docs, total: countRow.count, page, totalPages: Math.max(1, Math.ceil(countRow.count / perPage)) };
}

export interface DocPageFull extends DocPage {
  content_text: string | null;
  content_html: string | null;
}

export function getDocById(id: number): DocPageFull | null {
  return (getDb().prepare(
    'SELECT * FROM doc_pages WHERE id = ?'
  ).get(id) as DocPageFull | undefined) ?? null;
}

export function getDocIdByUrl(url: string): number | null {
  const row = getDb().prepare('SELECT id FROM doc_pages WHERE url = ? ORDER BY id LIMIT 1').get(url) as { id: number } | undefined;
  return row?.id ?? null;
}

export interface DocSourceCount {
  source: string;
  count: number;
  url: string | null;
}

export function getDocSources(q?: string): DocSourceCount[] {
  const db = getDb();
  if (q && q.trim()) {
    const ftsQ = ftsPrefixMatch(q);
    if (!ftsQ) return [];
    return db.prepare(
      `SELECT d.source, COUNT(*) as count, MIN(d.url) as url FROM doc_pages d JOIN docs_fts ON d.id = docs_fts.rowid WHERE docs_fts MATCH ? ${TITLE_FILTER} ${DEDUP_CLAUSE} GROUP BY d.source ORDER BY count DESC, d.source`
    ).all(ftsQ) as DocSourceCount[];
  }
  return db.prepare(
    `SELECT d.source, COUNT(*) as count, MIN(d.url) as url FROM doc_pages d WHERE 1=1 ${TITLE_FILTER} ${DEDUP_CLAUSE} GROUP BY d.source ORDER BY count DESC, d.source`
  ).all() as DocSourceCount[];
}

export interface DocsGlance {
  updatedThisWeek: number;
  newest: { id: number; title: string; last_modified: string } | null;
  synced: string | null;
}

export function getDocsGlance(now: Date = new Date()): DocsGlance {
  const db = getDb();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const week = db.prepare(
    `SELECT COUNT(*) as n FROM doc_pages d WHERE EXISTS (
       SELECT 1 FROM change_events e WHERE e.subject = 'doc:' || d.url AND e.kind IN ('doc_added', 'doc_changed') AND e.observed_at >= ?
     ) ${TITLE_FILTER} ${DEDUP_CLAUSE}`
  ).get(weekAgo) as { n: number };
  const newest = db.prepare(
    `SELECT d.id, d.title, MAX(e.observed_at) AS last_modified FROM doc_pages d
       JOIN change_events e ON e.subject = 'doc:' || d.url AND e.kind IN ('doc_added', 'doc_changed')
      WHERE 1 = 1 ${TITLE_FILTER} ${DEDUP_CLAUSE}
      GROUP BY d.id ORDER BY last_modified DESC, d.id LIMIT 1`
  ).get() as DocsGlance['newest'] | undefined;
  const synced = db.prepare('SELECT MAX(synced_at) as s FROM doc_pages').get() as { s: string | null };
  return { updatedThisWeek: week.n, newest: newest ?? null, synced: synced.s };
}

export function getDocsTotalCount(): number {
  return (getDb().prepare('SELECT COUNT(*) as c FROM doc_pages').get() as { c: number }).c;
}
