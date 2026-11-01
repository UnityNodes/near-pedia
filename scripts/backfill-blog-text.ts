/**
 * Re-derive blog_posts.content_text from the already-stored content_html,
 * for every row - not just the ones sync-blog.ts's sitemap still lists.
 *
 * WHY THIS EXISTS. sync-blog.ts stored content_text via node-html-parser's
 * bare `.text`, which joins text nodes with nothing between them - no space
 * or newline at a `</p><p>` or `</div><div>` boundary - so two adjacent
 * paragraphs read as one glued word ("perspective.Community"). Fixed in
 * sync-blog.ts to use htmlToTextWithCode() instead, which inserts a newline
 * at each block-level closing tag before stripping markup. That fixes every
 * FUTURE sync, but sync-blog.ts only re-fetches the ~70 posts still listed
 * in the live sitemap - re-running it after the fix corrected those and left
 * roughly 300 older posts (of 343 originally affected, measured by a
 * CamelCase-run scan) exactly as glued as before.
 *
 * content_html was never wrong - it is the raw scraped innerHTML, stored
 * untouched by this bug - so every row can be corrected offline, from its
 * own already-stored evidence, with no network call and no re-scrape.
 *
 *   npx tsx scripts/backfill-blog-text.ts
 *   npx tsx scripts/backfill-blog-text.ts --dry-run
 */

import { getDb } from '../lib/db';
import { htmlToTextWithCode } from '../lib/html-extract';
import { isEntrypoint } from '../lib/is-entrypoint';

const DRY_RUN = process.argv.includes('--dry-run');

function main(): void {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, content_html, content_text FROM blog_posts WHERE content_html IS NOT NULL AND content_html <> ''`,
  ).all() as Array<{ id: string; content_html: string; content_text: string | null }>;

  const update = db.prepare(`UPDATE blog_posts SET content_text = ? WHERE id = ?`);
  let changed = 0;
  const tx = db.transaction((rs: typeof rows) => {
    for (const r of rs) {
      const fixed = htmlToTextWithCode(r.content_html);
      if (fixed === r.content_text || !fixed) continue;
      changed++;
      if (!DRY_RUN) update.run(fixed, r.id);
    }
  });
  tx(rows);

  if (!DRY_RUN && changed) {
    try { db.exec("INSERT INTO blog_posts_fts(blog_posts_fts) VALUES('rebuild')"); } catch { /* fts optional */ }
  }

  console.log(`[backfill-blog-text] ${rows.length} row(s) read, ${changed} re-derived${DRY_RUN ? ' (dry run: nothing written)' : ''}`);
}

if (isEntrypoint(import.meta.url)) main();
