/**
 * Populate foundation_kb from the official yourchain.example About page data.
 *
 * get_foundation_info advertises "team bios, board, working groups, membership,
 * grant-programme info", but foundation_kb was never written by anything, so the
 * tool silently fell through to a full-text search over ALL doc_pages - a query
 * for "team" answered with an unrelated node-monitoring ADR.
 *
 * Source: your-org/yourchain.example src/data/about/team.ts. Same trick as
 * sync-ecosystem: the file is a plain object literal with no type annotations,
 * so it evaluates as JS once the exports are turned into a returned object.
 * Only what upstream actually publishes is stored - nothing is inferred.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { getDb } from '../lib/db';
import { guardSync } from '../lib/sync-log';
import { SITE } from '../lib/site.config';

const SRC = 'https://raw.githubusercontent.com/your-org/yourchain.example/main/src/data/about/team.ts';
const ABOUT_URL = 'https://yourchain.example/about';

interface Leader { name?: string; role?: string; bio?: string }
interface Member { name?: string; role?: string; prev?: string; edu?: string }
interface Stat { number?: string; label?: string }

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 32);
}

async function main() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS foundation_kb (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL, key TEXT, title TEXT NOT NULL, content TEXT NOT NULL,
    url TEXT, replaced_by TEXT, tags TEXT, metadata TEXT, url_status INTEGER,
    url_last_checked_at TEXT, linked_doc_page_id INTEGER REFERENCES doc_pages(id),
    content_hash TEXT NOT NULL, kb_version TEXT, synced_at TEXT NOT NULL,
    UNIQUE(category, key))`);

  const res = await fetch(SRC, { headers: { 'User-Agent': `${SITE.name}-Bot/1.0` } });
  if (!res.ok) {
    throw new Error(`[sync-foundation] source unavailable: HTTP ${res.status} for ${SRC}`);
  }
  let src = await res.text();
  // Turn the ES module into an expression we can evaluate.
  src = src.replace(/export\s+const\s+(\w+)\s*=/g, 'const $1 =');
  const data = new Function(
    `${src}; return { aboutStats, leadership, fullTeam };`,
  )() as { aboutStats?: Stat[]; leadership?: Leader[]; fullTeam?: Member[] };

  const leadership = data.leadership ?? [];
  const fullTeam = data.fullTeam ?? [];
  const stats = data.aboutStats ?? [];
  if (leadership.length === 0 && fullTeam.length === 0) {
    throw new Error('[sync-foundation] parsed 0 people - upstream shape changed, refusing to write');
  }

  const now = new Date().toISOString();
  const upsert = db.prepare(`INSERT INTO foundation_kb
    (category, key, title, content, url, tags, content_hash, synced_at)
    VALUES (@category, @key, @title, @content, @url, @tags, @content_hash, @synced_at)
    ON CONFLICT(category, key) DO UPDATE SET
      title = excluded.title, content = excluded.content, url = excluded.url,
      tags = excluded.tags, content_hash = excluded.content_hash,
      synced_at = excluded.synced_at`);

  const rows: Array<Record<string, string | null>> = [];

  for (const p of leadership) {
    if (!p.name) continue;
    const content = [p.role, p.bio].filter(Boolean).join('\n\n');
    rows.push({
      category: 'leadership', key: p.name, title: `${p.name} - ${p.role ?? 'Leadership'}`,
      content, url: ABOUT_URL, tags: 'leadership,team,foundation', content_hash: hash(content),
      synced_at: now,
    });
  }

  for (const p of fullTeam) {
    if (!p.name) continue;
    const content = [
      p.role,
      p.prev ? `Previously: ${p.prev}` : null,
      p.edu ? `Education: ${p.edu}` : null,
    ].filter(Boolean).join('\n');
    rows.push({
      category: 'team', key: p.name, title: `${p.name} - ${p.role ?? 'Team'}`,
      content, url: ABOUT_URL, tags: 'team,foundation', content_hash: hash(content),
      synced_at: now,
    });
  }

  if (stats.length > 0) {
    const content = stats
      .filter((s) => s.number && s.label)
      .map((s) => `${s.number} - ${s.label}`)
      .join('\n');
    if (content) {
      rows.push({
        category: 'about', key: 'stats', title: 'NEAR at a glance',
        content, url: ABOUT_URL, tags: 'about,foundation,stats',
        content_hash: hash(content), synced_at: now,
      });
    }
  }

  db.transaction(() => { for (const r of rows) upsert.run(r); })();

  const total = (db.prepare('SELECT COUNT(*) c FROM foundation_kb').get() as { c: number }).c;
  console.log(`[sync-foundation] wrote ${rows.length} entries (leadership ${leadership.length}, team ${fullTeam.length}), total ${total}`);
  return rows.length;
}

guardSync('foundation', main).catch((e) => { console.error(e); process.exit(1); });
