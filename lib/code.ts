import { getDb } from './db';
import { escLike } from './rank';

export interface CodeItem {
  id: string;
  type: string;
  repo: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  author: string | null;
  created_at: string;
  url: string;
  labels: string | null;
  board_status: string | null;
}

export interface GetCodeItemsOptions {
  repo?: string;
  state?: string;
  type?: string;
  q?: string;
  page?: number;
  perPage?: number;
}

export interface GetCodeItemsResult {
  items: CodeItem[];
  total: number;
  page: number;
  totalPages: number;
  repoCounts: Array<{ repo: string; count: number }>;
}

export function getCodeItems(opts: GetCodeItemsOptions): GetCodeItemsResult {
  const db = getDb();
  const page = Math.max(1, opts.page ?? 1);
  const perPage = opts.perPage ?? 30;
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.repo) {
    conditions.push('repo = ?');
    params.push(opts.repo);
  }
  if (opts.state) {
    conditions.push('state = ?');
    params.push(opts.state);
  }
  if (opts.type) {
    conditions.push('type = ?');
    params.push(opts.type);
  }
  if (opts.q && opts.q.trim()) {
    const like = `%${escLike(opts.q.trim())}%`;
    conditions.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`SELECT COUNT(*) as c FROM github_items ${where}`).get(...params) as { c: number }).c;
  const items = db.prepare(
    `SELECT id, type, repo, number, title, body, state, author, created_at, url, labels, board_status
     FROM github_items ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, perPage, offset) as CodeItem[];

  const repoCounts = db.prepare(
    `SELECT repo, COUNT(*) as count FROM github_items GROUP BY repo ORDER BY count DESC`
  ).all() as Array<{ repo: string; count: number }>;

  return { items, total, page, totalPages: Math.max(1, Math.ceil(total / perPage)), repoCounts };
}
