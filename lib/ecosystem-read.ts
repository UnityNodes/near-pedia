/**
 * Reading the ecosystem tables for agents and the REST API: NEAR Catalog
 * projects with TVL, security incidents, and the partner registry joined to
 * both. Project and incident text is written by third parties (catalog
 * self-listings, DefiLlama's descriptions): rendered through the caller's
 * fence.
 */

import type Database from 'better-sqlite3';
import { escLike } from './rank';
import { usd } from './incidents';
import { CATALOG_PAGE_URL } from './near-catalog';
import { PARTNERS, getPartner, type Partner } from './partners';

export interface ProjectRow {
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  category: string | null;
  tags: string | null;
  url: string;
  website: string | null;
  github: string | null;
  twitter: string | null;
  dapp: string | null;
  phase: string | null;
  catalog_status: string | null;
  tokens: string | null;
  tvl_usd: number | null;
  tvl_components: string | null;
  tvl_at: string | null;
  liveness: string | null;
  catalog_updated_at: string | null;
  synced_at: string | null;
}

export interface IncidentRow {
  id: string;
  name: string;
  date: string;
  amount_usd: number | null;
  returned_usd: number | null;
  chains: string;
  classification: string | null;
  technique: string | null;
  target_type: string | null;
  bridge_hack: number;
  description: string | null;
  source_url: string;
  relevance: 'near' | 'related';
  catalog_slug: string | null;
  synced_at: string;
}

type Fence = (s: string) => string;

const PROJECT_COLS = 'slug, title, tagline, description, category, tags, url, website, github, twitter, dapp, phase, catalog_status, tokens, tvl_usd, tvl_components, tvl_at, liveness, catalog_updated_at, synced_at';

export function catalogSynced(db: Database.Database): boolean {
  return Boolean(db.prepare("SELECT 1 FROM ecosystem_projects WHERE source = 'nearcatalog.xyz' LIMIT 1").get());
}

export function incidentsSynced(db: Database.Database): boolean {
  return Boolean(db.prepare('SELECT 1 FROM incidents LIMIT 1').get());
}

/** By slug as stored, or as a router hands it over already decoded ("%ef%b8%8f" arrives as the character). */
export function getProject(db: Database.Database, slug: string): ProjectRow | null {
  const s = slug.trim();
  const stmt = db.prepare(`SELECT ${PROJECT_COLS} FROM ecosystem_projects WHERE slug = ?`);
  return (stmt.get(s.toLowerCase()) as ProjectRow | undefined) ?? (stmt.get(encodeURIComponent(s).toLowerCase()) as ProjectRow | undefined) ?? null;
}

/**
 * Projects by name first, then by any text: an exact title or slug, a title
 * prefix, then a match anywhere in tagline, tags or description. Ties go to
 * the larger TVL, so "rhea" finds Rhea Finance before a project that
 * mentions it.
 */
export function findProjects(db: Database.Database, q: string, opts: { category?: string; limit: number }): ProjectRow[] {
  const t = q.trim().toLowerCase();
  const like = `%${escLike(t)}%`;
  const prefix = `${escLike(t)}%`;
  const params: unknown[] = [t, t, prefix, like, like, like, like, like, like, like];
  const cat = opts.category ? 'AND category = ? COLLATE NOCASE' : '';
  if (opts.category) params.push(opts.category);
  return db.prepare(`
    SELECT ${PROJECT_COLS},
      CASE WHEN lower(title) = ? OR slug = ? THEN 0 WHEN lower(title) LIKE ? ESCAPE '\\' THEN 1 WHEN lower(title) LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\' THEN 2 ELSE 3 END AS rank_
    FROM ecosystem_projects
    WHERE (lower(title) LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\' OR lower(tagline) LIKE ? ESCAPE '\\' OR lower(tags) LIKE ? ESCAPE '\\' OR lower(description) LIKE ? ESCAPE '\\') ${cat}
    ORDER BY rank_, COALESCE(tvl_usd, 0) DESC, title COLLATE NOCASE
    LIMIT ?`).all(...params, opts.limit) as ProjectRow[];
}

/** Projects by TVL on NEAR; within a category, the ones without TVL follow by name. */
export function topByTvl(db: Database.Database, limit: number, category?: string): ProjectRow[] {
  if (category) {
    return db.prepare(`SELECT ${PROJECT_COLS} FROM ecosystem_projects WHERE category = ? COLLATE NOCASE ORDER BY COALESCE(tvl_usd, 0) DESC, title COLLATE NOCASE LIMIT ?`).all(category, limit) as ProjectRow[];
  }
  return db.prepare(`SELECT ${PROJECT_COLS} FROM ecosystem_projects WHERE tvl_usd IS NOT NULL ORDER BY tvl_usd DESC LIMIT ?`).all(limit) as ProjectRow[];
}

export function listIncidents(db: Database.Database, opts: { relevance?: 'near' | 'related' | 'all'; q?: string; project?: string; limit: number }): IncidentRow[] {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts.relevance && opts.relevance !== 'all') { conds.push('relevance = ?'); params.push(opts.relevance); }
  if (opts.project) { conds.push('catalog_slug = ?'); params.push(opts.project); }
  if (opts.q?.trim()) {
    const like = `%${escLike(opts.q.trim().toLowerCase())}%`;
    conds.push("(lower(name) LIKE ? ESCAPE '\\' OR lower(technique) LIKE ? ESCAPE '\\' OR lower(description) LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM incidents ${where} ORDER BY date DESC, id LIMIT ?`).all(...params, opts.limit) as IncidentRow[];
}

export function getIncident(db: Database.Database, id: string): IncidentRow | null {
  return (db.prepare('SELECT * FROM incidents WHERE id = ?').get(id.trim().toLowerCase()) as IncidentRow | undefined) ?? null;
}

export function partnerOfProject(slug: string): Partner | null {
  return PARTNERS.find((p) => p.catalog_slugs.includes(slug)) ?? null;
}

export function partnerDocsCount(db: Database.Database, p: Partner): number {
  if (!p.docs_feed) return 0;
  return (db.prepare("SELECT COUNT(*) n FROM doc_pages WHERE source = 'partner-docs' AND url LIKE ?").get(`${p.docs_feed.origin}/%`) as { n: number }).n;
}

export const parseJson = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export function renderIncident(i: IncidentRow, fence: Fence, opts: { toolHints?: boolean } = {}): string {
  const chains = parseJson<string[]>(i.chains, []);
  const lost = usd(i.amount_usd);
  const back = i.returned_usd ? `, ${usd(i.returned_usd)} returned` : '';
  const lines = [
    `${i.date}  ${fence(i.name)}: ${lost}${back}  [${i.relevance === 'near' ? 'NEAR' : 'NEAR Catalog project, hacked elsewhere'}]  id: ${i.id}`,
    `  ${[i.classification, i.technique, i.target_type].filter(Boolean).map((v) => fence(v!)).join(' · ')}${chains.length ? `  chains: ${fence(chains.join(', '))}` : ''}${i.bridge_hack ? '  bridge' : ''}`,
  ];
  if (i.catalog_slug) lines.push(`  project: ${i.catalog_slug}${opts.toolHints === false ? '' : ' (find_project)'}`);
  lines.push(`  source: ${i.source_url}`);
  return lines.join('\n');
}

export function renderProject(p: ProjectRow, fence: Fence, extra: { incidents?: IncidentRow[]; partner?: Partner | null } = {}): string {
  const tokens = parseJson<Array<{ symbol: string; near: string | null }>>(p.tokens, []);
  const tvl = parseJson<Array<{ name: string; tvl_usd: number }>>(p.tvl_components, []);
  const head = `${fence(p.title)}  (${p.slug})${p.category ? `  · ${fence(p.category)}` : ''}${p.phase ? `  · ${fence(p.phase)}` : ''}${p.catalog_status && p.catalog_status !== 'active' ? `  · catalog status: ${fence(p.catalog_status)}` : ''}${p.liveness === 'dead' ? '  · site unreachable on repeated checks' : ''}`;
  const lines = [head];
  if (p.tagline || p.description) lines.push(`  ${fence(((p.tagline ?? p.description) as string).slice(0, 240))}`);
  if (p.tvl_usd !== null) lines.push(`  TVL on NEAR: ${usd(p.tvl_usd)} (DefiLlama, ${p.tvl_at?.slice(0, 10)})${tvl.length > 1 ? `: ${tvl.map((c) => `${fence(c.name)} ${usd(c.tvl_usd)}`).join(' + ')}` : ''}`);
  if (tokens.length) lines.push(`  tokens: ${tokens.map((t) => (t.near ? `${fence(t.symbol)} (${fence(t.near)})` : fence(t.symbol))).join(', ')}`);
  const links = [p.website && `site ${p.website}`, p.github && `GitHub ${p.github}`, p.dapp && p.dapp !== p.website && `app ${p.dapp}`].filter(Boolean);
  if (links.length) lines.push(`  ${links.join(' · ')}`);
  if (extra.partner) lines.push(`  NEAR partner: ${extra.partner.name}, see get_partner("${extra.partner.id}") for contracts and docs`);
  if (extra.incidents?.length) {
    lines.push(`  security incidents (${extra.incidents.length}):`);
    for (const i of extra.incidents) lines.push(`    ${i.date} ${fence(i.name)}: ${usd(i.amount_usd)}${i.technique ? `, ${fence(i.technique)}` : ''}  ${i.source_url}`);
  }
  lines.push(`  catalog: ${CATALOG_PAGE_URL(p.slug)}`);
  return lines.join('\n');
}

export function renderPartner(db: Database.Database, p: Partner, fence: Fence): string {
  const projects = p.catalog_slugs.map((s) => getProject(db, s)).filter((r): r is ProjectRow => r !== null);
  const incidents = p.catalog_slugs.flatMap((s) => listIncidents(db, { project: s, relevance: 'all', limit: 20 }));
  const docs = partnerDocsCount(db, p);
  const lines = [
    `${p.name}  (${p.id})`,
    p.summary,
    `site ${p.website} · docs ${p.docs}${p.llms_txt ? ` · llms.txt ${p.llms_txt}` : ''}`,
    `docs in this index: ${docs ? `${docs} pages (search and semantic_search find them)` : 'not ingested; read the llms.txt above'}`,
    `GitHub: ${p.github.map((g) => `https://github.com/${g}`).join(', ')}`,
    ...(p.contracts.length ? ['contracts (mainnet):', ...p.contracts.map((c) => `  ${c.account}: ${c.role}`)] : ['contracts (mainnet): none of its own']),
  ];
  for (const r of projects) lines.push('', renderProject(r, fence));
  if (incidents.length) {
    lines.push('', `security incidents (${incidents.length}):`);
    for (const i of incidents) lines.push(renderIncident(i, fence));
  }
  return lines.join('\n');
}

export { getPartner, PARTNERS };
