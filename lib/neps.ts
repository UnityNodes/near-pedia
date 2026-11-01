/**
 * NEAR Enhancement Proposals from github.com/near/NEPs: one Markdown file
 * per standard under neps/ (older ones under neps/archive/), each opening
 * with a front-matter block:
 *
 *   NEP: 141
 *   Title: Fungible Token Standard
 *   Status: Final
 *   Type: Standards Track
 *   Category: Contract
 *   Replaces: 21
 *   Requires: 297
 *
 * Archive files predate the front matter and carry the number in their
 * name (archive/0005-access-keys.md); their title is the first heading.
 */

import { createHash } from 'node:crypto';

export const NEPS_REPO = 'near/NEPs';
export const NEPS_BRANCH = 'master';

export interface Nep {
  nep: number;
  title: string;
  status: string | null;
  type: string | null;
  category: string | null;
  authors: string | null;
  created: string | null;
  replaces: number[];
  requires: number[];
  superseded_by: number[];
  discussion_url: string | null;
  path: string;
  url: string;
  archived: boolean;
  content_md: string;
  content_hash: string;
}

const nums = (v: string | undefined) => (v ? [...v.matchAll(/\d+/g)].map((m) => Number(m[0])) : []);

export function isNepPath(path: string): boolean {
  return /^neps\/(?:archive\/)?(?:nep-)?\d{4}[\w-]*\.md$/.test(path);
}

export function parseNep(path: string, text: string): Nep | null {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const fields: Record<string, string> = {};
  for (const line of (fm?.[1] ?? '').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (m) fields[m[1].toLowerCase()] = m[2].trim();
  }
  const body = fm ? text.slice(fm[0].length) : text;
  const fromName = path.match(/(?:nep-)?(\d{4})/);
  const nep = Number(fields.nep ?? fromName?.[1]);
  if (!Number.isInteger(nep) || nep <= 0) return null;
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const fallback = path.split('/').pop()!.replace(/\.md$/, '').replace(/^(?:nep-)?\d{4}-?/, '').replace(/-/g, ' ');
  return {
    nep,
    // An archive file's first heading is its first section ("# Summary"), not its name.
    title: fields.title || (fm ? heading : null) || fallback || heading || `NEP-${nep}`,
    status: fields.status || (path.includes('/archive/') ? 'Archived' : null),
    type: fields.type || null,
    category: fields.category || null,
    authors: fields.author || fields.authors || null,
    created: fields.created || null,
    replaces: nums(fields.replaces),
    requires: nums(fields.requires),
    superseded_by: nums(fields.supersededby ?? fields['superseded-by']),
    discussion_url: /^https?:\/\//.test(fields.discussionsto ?? '') ? fields.discussionsto : null,
    path,
    url: `https://github.com/${NEPS_REPO}/blob/${NEPS_BRANCH}/${path}`,
    archived: path.includes('/archive/'),
    content_md: body.trim(),
    content_hash: createHash('sha256').update(text).digest('hex').slice(0, 16),
  };
}

export const nepLabel = (n: number) => `NEP-${n}`;

/** "141", "NEP-141", "nep 141", "NEP-0141": the number, or null. */
export function nepNumber(raw: string): number | null {
  const m = raw.trim().match(/^(?:nep[-\s#]?)?0*(\d{1,4})$/i);
  return m ? Number(m[1]) : null;
}

export interface NepRow {
  nep: number; title: string; status: string | null; type: string | null; category: string | null; authors: string | null; created: string | null;
  replaces: string; requires: string; superseded_by: string; discussion_url: string | null; url: string; archived: number; content_md: string; synced_at: string;
}

type Db = import('better-sqlite3').Database;

export function getNepRow(db: Db, n: number): NepRow | null {
  return (db.prepare('SELECT * FROM nep_standards WHERE nep = ?').get(n) as NepRow | undefined) ?? null;
}

/** NEP number -> the NEPs whose `Replaces:` names it. Most files never set `SupersededBy`; the newer standard says what it replaces. */
export function replacedBy(db: Db): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const r of db.prepare('SELECT nep, replaces FROM nep_standards').all() as Array<{ nep: number; replaces: string }>) {
    let rep: number[] = [];
    try {
      rep = JSON.parse(r.replaces) as number[];
    } catch {
      rep = [];
    }
    for (const old of rep) out.set(old, [...(out.get(old) ?? []), r.nep]);
  }
  return out;
}

/**
 * By title words first, then by text; a standard another NEP replaces goes
 * after the live ones ("fungible token" put NEP-21 ahead of NEP-141, which
 * replaces it), and archived drafts last.
 */
export function findNeps(db: Db, q: string, limit: number): Array<NepRow & { replaced_by: number[] }> {
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3).slice(0, 6);
  if (!words.length) return [];
  // Each term in its own parentheses: `a LIKE ? ESCAPE '\\' + b LIKE ?` reads the
  // escape as '\\' + b, and no row ever matched.
  const titleHits = words.map(() => "(lower(title) LIKE ? ESCAPE '\\')").join(' + ');
  const textHits = words.map(() => "(lower(content_md) LIKE ? ESCAPE '\\')").join(' + ');
  const likes = words.map((w) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const rows = db.prepare(`SELECT *, (${titleHits}) * 10 + (${textHits}) AS score
    FROM nep_standards WHERE (${titleHits}) + (${textHits}) > 0 ORDER BY score DESC, nep LIMIT ?`)
    .all(...likes, ...likes, ...likes, ...likes, limit * 4) as Array<NepRow & { score: number }>;
  const by = replacedBy(db);
  const rank = (r: NepRow) => (r.archived ? 2 : by.has(r.nep) ? 1 : 0);
  return rows
    .map((r) => ({ ...r, replaced_by: by.get(r.nep) ?? [] }))
    .sort((a, b) => Math.floor(b.score / 10) - Math.floor(a.score / 10) || rank(a) - rank(b) || b.score - a.score || a.nep - b.nep)
    .slice(0, limit);
}

const list = (json: string) => {
  try {
    return (JSON.parse(json) as number[]).map(nepLabel);
  } catch {
    return [];
  }
};

export function renderNep(n: NepRow & { replaced_by?: number[] }, opts: { full: boolean; maxChars?: number }): string {
  const meta = [n.status, n.type, n.category].filter(Boolean).join(' · ');
  const rel = [
    list(n.requires).length ? `requires ${list(n.requires).join(', ')}` : '',
    list(n.replaces).length ? `replaces ${list(n.replaces).join(', ')}` : '',
    list(n.superseded_by).length ? `SUPERSEDED BY ${list(n.superseded_by).join(', ')}` : '',
    n.replaced_by?.length ? `REPLACED BY ${n.replaced_by.map(nepLabel).join(', ')}` : '',
  ].filter(Boolean).join('; ');
  const head = `${nepLabel(n.nep)}: ${n.title}${meta ? `  (${meta})` : ''}${n.archived ? '  [archived draft]' : ''}\n${n.url}${n.created ? `  ·  created ${n.created}` : ''}${rel ? `\n${rel}` : ''}`;
  if (!opts.full) return head;
  const max = opts.maxChars ?? 12_000;
  const body = n.content_md.length > max ? `${n.content_md.slice(0, max)}\n\n… cut at ${max} of ${n.content_md.length} characters; the full text is at ${n.url}` : n.content_md;
  return `${head}\nsynced ${n.synced_at.slice(0, 16)} UTC\n\n${body}`;
}
