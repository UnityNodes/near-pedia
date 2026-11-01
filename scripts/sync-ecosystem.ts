/**
 * Sync the YourChain ecosystem directory (86 projects) from the official
 * yourchain.example ecosystemExplorer.js into the ecosystem_projects table that the
 * /ecosystem page reads. Creates the table if the template DB lacks it.
 */
import 'dotenv/config';
import { guardSync } from '../lib/sync-log';
import { getDb } from '../lib/db';
import { isEntrypoint } from '../lib/is-entrypoint';
import { isoNowSql } from '../lib/formats';

// Upstream rewrote this file from .js to .ts (same `export const ecosystemData`
// object literal, same { categories, items } shape - no type annotations, so it
// still evaluates as plain JS). The old .js path 404s.
// Exported so check-completeness.ts recounts the same file this sync reads,
// rather than a second copy of the URL that can drift from it.
export const SRC = 'https://raw.githubusercontent.com/your-org/yourchain.example/main/src/data/ecosystem/ecosystemExplorer.ts';

interface EcosystemItem { title?: string; url?: string; description?: string | null; categories: string; subcategory?: string | string[]; image?: string }
interface EcosystemData { categories?: { id: string; name: string; subcategories?: { id: string; name: string }[] }[]; items?: EcosystemItem[] }

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

async function main() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS ecosystem_projects (
    slug TEXT PRIMARY KEY, title TEXT, description TEXT, category TEXT, url TEXT,
    tags TEXT, source TEXT, tier TEXT DEFAULT 'secondary', synced_at TEXT,
    logo TEXT)`);
  // Existing DBs predate later columns; CREATE TABLE IF NOT EXISTS won't add them.
  const cols = db.prepare('PRAGMA table_info(ecosystem_projects)').all() as Array<{ name: string }>;
  const has = (name: string) => cols.some((c) => c.name === name);
  if (!has('logo')) db.exec('ALTER TABLE ecosystem_projects ADD COLUMN logo TEXT');
  // check-ecosystem-liveness.ts's own columns. Declared here too, not just
  // there, so this sync's INSERT keeps agreeing with the full column list
  // below regardless of which script runs first on a fresh DB.
  for (const [name, type] of [
    ['liveness', 'TEXT'], ['url_status', 'TEXT'], ['last_check_at', 'TEXT'],
    ['http_status', 'INTEGER'], ['check_note', 'TEXT'],
    ['fail_streak', 'INTEGER DEFAULT 0'], ['dead_since', 'TEXT'], ['last_activity_at', 'TEXT'],
  ]) {
    if (!has(name)) db.exec(`ALTER TABLE ecosystem_projects ADD COLUMN ${name} ${type}`);
  }

  const res = await fetch(SRC);
  // Without this check the 404 BODY ("404: Not Found") was fed straight into
  // new Function(), producing a bewildering `SyntaxError: Unexpected token ':'`
  // instead of naming the real problem. The upstream file moved; fail loudly.
  if (!res.ok) {
    throw new Error(
      `[sync-ecosystem] source unavailable: HTTP ${res.status} for ${SRC}. ` +
      `The upstream ecosystem file moved - update SRC before this sync can run.`,
    );
  }
  let src = await res.text();
  src = src.replace(/export\s+const\s+ecosystemData\s*=/, 'return ');
  const data = new Function(src)() as EcosystemData;

  const catName = new Map<string, string>();
  const subName = new Map<string, string>();
  for (const c of data.categories ?? []) {
    catName.set(c.id, c.name);
    for (const s of c.subcategories ?? []) subName.set(s.id, s.name);
  }

  const items: EcosystemItem[] = data.items ?? [];
  // ON CONFLICT DO UPDATE, not INSERT OR REPLACE: a re-sync wiped
  // check-ecosystem-liveness.ts's columns (liveness, fail_streak,
  // dead_since, ...) back to their defaults on every run, because REPLACE
  // deletes the row before re-inserting it and this statement never named
  // them. Same trap this app's own CLAUDE.md documents for the mailing
  // sync's cips upsert.
  const ins = db.prepare(`INSERT INTO ecosystem_projects
    (slug,title,description,category,url,tags,source,tier,synced_at,logo)
    VALUES (?,?,?,?,?,?,?,?,${isoNowSql()},?)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title, description = excluded.description, category = excluded.category,
      url = excluded.url, tags = excluded.tags, source = excluded.source, tier = excluded.tier,
      synced_at = excluded.synced_at, logo = excluded.logo`);
  let n = 0;
  let withLogo = 0;
  for (const it of items) {
    if (!it.title || !it.url) continue;
    const cat = catName.get(it.categories) ?? it.categories ?? 'Ecosystem';
    const subs = Array.isArray(it.subcategory) ? it.subcategory.map((s: string) => subName.get(s) ?? s) : (it.subcategory ? [subName.get(it.subcategory) ?? it.subcategory] : []);
    // Upstream stores site-relative paths (/images/app/ecosystem/x.png).
    const logo = it.image
      ? (/^https?:\/\//.test(it.image) ? it.image : `https://yourchain.example${it.image}`)
      : null;
    if (logo) withLogo++;
    ins.run(slugify(it.title), it.title, it.description ?? null, cat, it.url, subs.join(', ') || null, 'yourchain.example', 'secondary', logo);
    n++;
  }
  const total = (db.prepare('SELECT COUNT(*) c FROM ecosystem_projects').get() as { c: number }).c;
  const cats = db.prepare('SELECT category, COUNT(*) c FROM ecosystem_projects GROUP BY category ORDER BY c DESC').all();
  console.log(`ecosystem items ${items.length}, inserted ${n} (${withLogo} with logo), total ${total}`);
  console.log('by category:', JSON.stringify(cats));
  return n;
}
// isEntrypoint, not a bare call: check-completeness.ts imports SRC above so
// its own count reads the same file this sync evaluates. Without this
// guard, that import ran the whole sync against the live database -
// discovered empirically on 2026-08-02 when check-completeness.ts's first
// run did exactly that.
if (isEntrypoint(import.meta.url)) {
  guardSync('ecosystem', main).catch((e) => { console.error(e); process.exit(1); });
}
