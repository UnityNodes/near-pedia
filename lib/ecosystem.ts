import { getDb } from './db';
import { escLike } from './rank';

/** Mirrors the ecosystem_projects table exactly - see scripts/sync-ecosystem.ts. */
export interface EcosystemProject {
  slug: string;
  title: string;
  description: string | null;
  category: string | null;
  url: string;
  tags: string | null;
  source: string;
  tier: string | null;
  synced_at: string | null;
  logo: string | null;
}

export interface GetEcosystemOptions {
  category?: string;
  q?: string;
  page?: number;
  perPage?: number;
}

export interface GetEcosystemResult {
  projects: EcosystemProject[];
  total: number;
  page: number;
  totalPages: number;
  categories: Array<{ category: string; count: number }>;
}

export function getEcosystemProjects(opts: GetEcosystemOptions = {}): GetEcosystemResult {
  const db = getDb();
  const page = Math.max(1, opts.page ?? 1);
  const perPage = opts.perPage ?? 60;
  const offset = (page - 1) * perPage;

  const conds: string[] = []; const params: unknown[] = [];
  if (opts.category) { conds.push('category = ?'); params.push(opts.category); }
  if (opts.q && opts.q.trim()) {
    const like = `%${escLike(opts.q.trim())}%`;
    conds.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  let total = 0;
  let projects: EcosystemProject[] = [];
  let categories: Array<{ category: string; count: number }> = [];
  try {
    total = (db.prepare(`SELECT COUNT(*) c FROM ecosystem_projects ${where}`).get(...params) as { c: number }).c;
    projects = db.prepare(`SELECT * FROM ecosystem_projects ${where} ORDER BY title COLLATE NOCASE ASC LIMIT ? OFFSET ?`).all(...params, perPage, offset) as EcosystemProject[];
    categories = db.prepare(`SELECT category, COUNT(*) as count FROM ecosystem_projects WHERE category IS NOT NULL AND category != '' GROUP BY category ORDER BY count DESC`).all() as Array<{ category: string; count: number }>;
  } catch {
    /* table not initialised */
  }

  return { projects, total, page, totalPages: Math.max(1, Math.ceil(total / perPage)), categories };
}
