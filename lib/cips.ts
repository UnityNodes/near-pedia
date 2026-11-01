import { getDb } from './db';
import { ftsPrefixMatch } from './rank';
import { cipMentionPatterns, cipCitesSql } from './cip-mention-patterns';
import { slugifyHeading } from './slug';

export interface CipRow {
  id: string;
  cip_number: number | null;
  title: string | null;
  author: string | null;
  status: string | null;
  type: string | null;
  created_date: string | null;
  approved_date: string | null;
  license: string | null;
  requires: string | null;
  content_md: string | null;
  pr_number: number | null;
  pr_url: string | null;
  tldr: string | null;
  tldr_generated_at: string | null;
  synced_at: string;
}

export type CipKind = 'all' | 'cip' | 'pr';

function kindSql(kind: CipKind | undefined, alias = ''): string | null {
  const col = alias ? `${alias}.cip_number` : 'cip_number';
  if (kind === 'cip') return `${col} IS NOT NULL`;
  if (kind === 'pr') return `${col} IS NULL`;
  return null;
}

const NEWEST_ORDER = "COALESCE(c.created_date, '') DESC, c.cip_number DESC";

export interface GetCipsOptions {
  q?: string;
  status?: string;
  type?: string;
  kind?: CipKind;
  sort?: 'newest' | 'oldest' | 'title' | 'author';
  page?: number;
  perPage?: number;
}

export interface GetCipsResult {
  cips: CipRow[];
  total: number;
  page: number;
  totalPages: number;
}

export function getCips(opts: GetCipsOptions): GetCipsResult {
  const db = getDb();
  const page = Math.max(1, opts.page ?? 1);
  const perPage = opts.perPage ?? 20;
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const filterParams: unknown[] = [];

  if (opts.status) {
    conditions.push('TRIM(c.status) = ?');
    filterParams.push(opts.status.trim());
  }
  if (opts.type) {
    conditions.push('TRIM(c.type) = ?');
    filterParams.push(opts.type.trim());
  }
  const kindCond = kindSql(opts.kind, 'c');
  if (kindCond) conditions.push(kindCond);

  if (opts.q && opts.q.trim()) {
    const ftsQuery = ftsPrefixMatch(opts.q);
    if (!ftsQuery) return { cips: [], total: 0, page, totalPages: 1 };
    const whereClause = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

    const countStmt = db.prepare(`
      SELECT COUNT(*) as count FROM cips c
      JOIN cips_fts ON c.rowid = cips_fts.rowid
      WHERE cips_fts MATCH ? ${whereClause}
    `);
    const countRow = countStmt.get(ftsQuery, ...filterParams) as { count: number };

    const rowsStmt = db.prepare(`
      SELECT c.* FROM cips c
      JOIN cips_fts ON c.rowid = cips_fts.rowid
      WHERE cips_fts MATCH ? ${whereClause}
      ORDER BY rank
      LIMIT ? OFFSET ?
    `);
    const cips = rowsStmt.all(ftsQuery, ...filterParams, perPage, offset) as CipRow[];

    const total = countRow.count;
    return { cips, total, page, totalPages: Math.max(1, Math.ceil(total / perPage)) };
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const orderBy = opts.sort === 'oldest'
    ? "COALESCE(c.created_date, '9999') ASC, c.cip_number ASC"
    : opts.sort === 'title'
      ? 'c.title COLLATE NOCASE ASC'
      : opts.sort === 'author'
        ? 'c.author COLLATE NOCASE ASC, c.cip_number DESC'
        : NEWEST_ORDER;

  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM cips c ${whereClause}`);
  const countRow = countStmt.get(...filterParams) as { count: number };

  const rowsStmt = db.prepare(`
    SELECT * FROM cips c ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `);
  const cips = rowsStmt.all(...filterParams, perPage, offset) as CipRow[];

  const total = countRow.count;
  return { cips, total, page, totalPages: Math.max(1, Math.ceil(total / perPage)) };
}

export function getCipById(id: string): CipRow | null {
  const db = getDb();
  const stripped = id.replace(/^CIP-/i, '');
  const isNumeric = /^\d+$/.test(stripped);
  const normalised = isNumeric ? stripped.padStart(4, '0') : stripped;
  const row = (db.prepare('SELECT * FROM cips WHERE id = ?').get(normalised) as CipRow | undefined) ?? null;
  if (row || !isNumeric) return row;

  // A CIP ingested from an open PR carries a 'PR-0117' id, so a numeric
  // reference ("/cips/117") finds no row by id and 404s. Fall back to
  // cip_number, preferring a merged row over a PR row when both exist.
  return (db.prepare(
    `SELECT * FROM cips WHERE cip_number = ?
     ORDER BY (id LIKE 'PR-%') ASC, id ASC LIMIT 1`,
  ).get(Number(stripped)) as CipRow | undefined) ?? null;
}

export function getDistinctStatuses(): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT DISTINCT TRIM(status) AS status FROM cips WHERE status IS NOT NULL ORDER BY TRIM(status)')
    .all() as { status: string }[];
  return rows.map(r => r.status.trim()).filter(Boolean);
}

export function getNewestCip(kind?: CipKind): { id: string; cip_number: number | null; pr_number: number | null; title: string | null } | null {
  const kindCond = kindSql(kind, 'c');
  const row = getDb().prepare(`
    SELECT c.id, c.cip_number, c.pr_number, c.title FROM cips c ${kindCond ? `WHERE ${kindCond}` : ''} ORDER BY ${NEWEST_ORDER} LIMIT 1
  `).get() as { id: string; cip_number: number | null; pr_number: number | null; title: string | null } | undefined;
  return row ?? null;
}

export interface StatusChange { from: string | null; to: string; at: string }

export function getLatestStatusChanges(ids: string[]): Map<string, StatusChange> {
  const out = new Map<string, StatusChange>();
  if (ids.length === 0) return out;
  const rows = getDb().prepare(`
    SELECT cip_id, from_status, to_status, changed_at FROM cip_status_history
    WHERE cip_id IN (${ids.map(() => '?').join(',')})
    ORDER BY changed_at DESC, id DESC
  `).all(...ids) as { cip_id: string; from_status: string | null; to_status: string; changed_at: string }[];
  for (const r of rows) {
    if (!out.has(r.cip_id)) out.set(r.cip_id, { from: r.from_status, to: r.to_status, at: r.changed_at });
  }
  return out;
}

export interface CipStatusCount { status: string; count: number }

export function getCipsTotalCount(kind?: CipKind): number {
  const db = getDb();
  const kindCond = kindSql(kind);
  return (db.prepare(`SELECT COUNT(*) AS c FROM cips${kindCond ? ` WHERE ${kindCond}` : ''}`).get() as { c: number }).c;
}

export function getKindCounts(): { cip: number; pr: number } {
  return { cip: getCipsTotalCount('cip'), pr: getCipsTotalCount('pr') };
}

export function getCipStatusCounts(kind?: CipKind): CipStatusCount[] {
  const db = getDb();
  const kindCond = kindSql(kind);
  return db.prepare(
    `SELECT TRIM(status) AS status, COUNT(*) AS count FROM cips
     WHERE status IS NOT NULL AND TRIM(status) != ''${kindCond ? ` AND ${kindCond}` : ''} GROUP BY TRIM(status) ORDER BY count DESC`,
  ).all() as CipStatusCount[];
}

export function getDistinctTypes(kind?: CipKind): string[] {
  const db = getDb();
  const kindCond = kindSql(kind);
  const rows = db.prepare(`SELECT DISTINCT TRIM(type) AS type FROM cips WHERE type IS NOT NULL${kindCond ? ` AND ${kindCond}` : ''} ORDER BY TRIM(type)`)
    .all() as { type: string }[];
  return rows.map(r => r.type.trim()).filter(Boolean);
}

export interface CipStatusHistoryRow {
  id: number;
  cip_id: string;
  from_status: string | null;
  to_status: string;
  changed_at: string;
}

export function getCipStatusHistoryCount(): number {
  const db = getDb();
  return (db.prepare('SELECT COUNT(*) as c FROM cip_status_history').get() as { c: number }).c;
}

export function getCipStatusHistory(cipId: string): CipStatusHistoryRow[] {
  const db = getDb();
  // Resolve through getCipById, not a bare strip+pad: cips.id holds two
  // namespaces under one prefix (a merged CIP's own number, or a PR-####
  // draft's GitHub PR number), and a draft that HAS declared a CIP number is
  // stored under its PR- id (getCipById falls back to cip_number for that
  // case). cip_status_history.cip_id is written as the exact cips.id string
  // (sync-cips.ts), so a bare numeric lookup here would miss a draft's real
  // history the moment it is far enough along to have one.
  const row = getCipById(cipId);
  if (!row) return [];
  return db.prepare(`
    SELECT id, cip_id, from_status, to_status, changed_at
    FROM cip_status_history
    WHERE cip_id = ?
    ORDER BY changed_at DESC
  `).all(row.id) as CipStatusHistoryRow[];
}

export interface CipAttachmentRow {
  id: number;
  cip_id: string;
  filename: string;
  github_url: string | null;
  raw_url: string | null;
  pages: number | null;
}

export function getCipAttachments(cipId: string): CipAttachmentRow[] {
  const db = getDb();
  // Same alias resolution as getCipStatusHistory above, for the same reason:
  // cip_attachments.cip_id is written as the exact cips.id string
  // (sync-cip-assets.ts), which for a numbered draft is its PR- id.
  const row = getCipById(cipId);
  if (!row) return [];
  return db.prepare(`
    SELECT id, cip_id, filename, github_url, raw_url, pages
    FROM cip_attachments
    WHERE cip_id = ?
    ORDER BY filename ASC
  `).all(row.id) as CipAttachmentRow[];
}

/**
 * Parse the free-form `requires` field into a list of normalised CIP IDs
 * (zero-padded 4 digits). The upstream format is inconsistent:
 *   "CIP-0056"
 *   "CIP 0060-Add Zero Hash..."
 *   "CIP-0056, CIP-0042"
 *   "0056"
 */
export function parseCipRequires(requires: string | null): string[] {
  if (!requires) return [];
  const ids = new Set<string>();
  const re = /CIP[\s-]*0*(\d{1,5})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(requires))) {
    const id = m[1].padStart(4, '0');
    ids.add(id);
  }
  return Array.from(ids);
}

/**
 * Build a forward + reverse adjacency list across all CIPs that participate
 * in a `requires` relationship. Used by /cips/graph.
 */
export function getCipRequiresGraph(): {
  nodes: Array<{ id: string; title: string; status: string | null }>;
  edges: Array<{ from: string; to: string }>;
} {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, title, status, requires
    FROM cips
    WHERE requires IS NOT NULL AND requires != ''
  `).all() as Array<{ id: string; title: string; status: string | null; requires: string | null }>;

  const edges: Array<{ from: string; to: string }> = [];
  const referencedIds = new Set<string>();
  for (const r of rows) {
    const targets = parseCipRequires(r.requires);
    for (const t of targets) {
      edges.push({ from: r.id, to: t });
      referencedIds.add(t);
    }
  }

  const nodeIds = new Set<string>([...rows.map(r => r.id), ...referencedIds]);
  const nodeMap = new Map<string, { id: string; title: string; status: string | null }>();
  if (nodeIds.size > 0) {
    const placeholders = Array.from(nodeIds).map(() => '?').join(',');
    const nodes = db.prepare(`SELECT id, title, status FROM cips WHERE id IN (${placeholders})`).all(...Array.from(nodeIds)) as Array<{ id: string; title: string; status: string | null }>;
    for (const n of nodes) nodeMap.set(n.id, n);
  }

  return {
    nodes: Array.from(nodeIds).map(id => nodeMap.get(id) ?? { id, title: `CIP-${id}`, status: null }),
    edges,
  };
}

export function getCipAttachmentCounts(): Map<string, number> {
  const db = getDb();
  const rows = db.prepare('SELECT cip_id, COUNT(*) AS c FROM cip_attachments GROUP BY cip_id').all() as
    Array<{ cip_id: string; c: number }>;
  return new Map(rows.map(r => [r.cip_id, r.c]));
}

export interface CipForumMention {
  topic_id: number;
  title: string;
  posts_count: number;
  last_post_at: string | null;
}

/**
 * Forum threads that mention "CIP-NNNN" in their title or first post.
 * Anchored: a plain substring test has no right edge, so "CIP-1" would
 * also match "CIP-10".."CIP-19" and any longer number starting with 1.
 */
export function getCipForumMentions(cipId: string): CipForumMention[] {
  const db = getDb();
  const p = cipMentionPatterns(cipId);
  if (!p) return [];
  return db.prepare(`
    SELECT ft.id as topic_id, ft.title, ft.posts_count, ft.last_post_at
    FROM forum_topics ft
    WHERE ${cipCitesSql('ft.title')}
    ORDER BY ft.last_post_at DESC
    LIMIT 8
  `).all(p.numericId) as CipForumMention[];
}

export interface CipBlogMention {
  id: string;
  title: string;
  excerpt: string | null;
  published_at: string | null;
  url: string;
  tags: string | null;
}

/**
 * Blog/news posts that mention "CIP-NNNN" anywhere in title or body.
 * Anchored - see getCipForumMentions above for why a plain substring
 * test over-reports.
 */
export function getCipBlogMentions(cipId: string): CipBlogMention[] {
  const db = getDb();
  const p = cipMentionPatterns(cipId);
  if (!p) return [];
  try {
    return db.prepare(`
      SELECT id, title, excerpt, published_at, url, tags
      FROM blog_posts
      WHERE ${cipCitesSql('title')} OR ${cipCitesSql('content_text')}
      ORDER BY published_at DESC
      LIMIT 8
    `).all(p.numericId, p.numericId) as CipBlogMention[];
  } catch {
    return [];
  }
}

export interface CipOtherMention {
  id: string;
  cip_number: number | null;
  title: string | null;
  status: string | null;
}

/**
 * Other CIPs that explicitly reference this one - either in their
 * `requires` field (curated dependency) or in their body markdown
 * (free-text mention). Used to surface 'related CIPs'.
 */
export function getCipOtherMentions(cipId: string): CipOtherMention[] {
  const db = getDb();
  const p = cipMentionPatterns(cipId);
  if (!p) return [];
  try {
    return db.prepare(`
      SELECT id, cip_number, title, status
      FROM cips
      WHERE id != ?
        AND (${cipCitesSql('requires')} OR ${cipCitesSql('content_md')})
      ORDER BY CAST(cip_number AS INTEGER) ASC
      LIMIT 12
    `).all(p.numericId, p.numericId, p.numericId) as CipOtherMention[];
  } catch {
    return [];
  }
}

export interface CipProposalMention {
  id: string;
  number: number;
  title: string;
  state: string;
  board_status: string | null;
}

/**
 * GitHub PRs/issues that reference this CIP in their title or body -
 * yourpedia's "proposals" are your-org issues and PRs, not grant
 * applications. Anchored - see getCipForumMentions above.
 */
export function getCipProposalMentions(cipId: string): CipProposalMention[] {
  const db = getDb();
  const p = cipMentionPatterns(cipId);
  if (!p) return [];
  try {
    return db.prepare(`
      SELECT id, number, title, state, board_status
      FROM github_items
      WHERE ${cipCitesSql('title')} OR ${cipCitesSql('body')}
      ORDER BY created_at DESC
      LIMIT 8
    `).all(p.numericId, p.numericId) as CipProposalMention[];
  } catch {
    return [];
  }
}

export function extractHeadings(markdown: string): { level: number; text: string; slug: string }[] {
  const headings: { level: number; text: string; slug: string }[] = [];
  const lines = markdown.split('\n');
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      const slug = slugifyHeading(text);
      headings.push({ level, text, slug });
    }
  }
  return headings;
}
