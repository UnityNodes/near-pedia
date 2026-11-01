import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDb } from '../lib/db';
import { stripHtmlTags } from '../lib/html-extract';

// One-time: scrub leaked HTML markup (syntax-highlighter <span>/<code>, stray
// <div>/<a>/etc.) out of doc_pages.content_text. node-html-parser's .text kept
// these out of <pre> code blocks, so answers built from it reproduced "create<span class=…>"
// noise. stripHtmlTags removes real tags only - <PLACEHOLDER> tokens survive.
// Changing content_text changes its content-hash, so build-embeddings re-embeds
// the affected docs on the next run.
//
// The trailing `.replace(/\s+/g, ' ')` this used to end with collapsed EVERY
// whitespace run, including the newlines inside a <pre> code block's already-
// clean text - stripHtmlTags() is newline-safe on its own ([ \t]{2,} and
// trailing-space-before-\n only), so that extra pass had nothing legitimate
// left to do and only flattened code. check-doc-structure.ts caught the
// damage: 67 pages across 10 doc sources had their multi-line code blocks
// reduced to a single run-on line. See scripts/fix-flattened-doc-code.ts for
// the one-time repair of the rows this already touched.

async function main() {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, content_text FROM doc_pages WHERE content_text LIKE '%<%>%'"
  ).all() as { id: number; content_text: string | null }[];
  console.log(`${rows.length} doc_pages contain tag-like markup`);

  const upd = db.prepare('UPDATE doc_pages SET content_text = ?, excerpt = ? WHERE id = ?');
  let changed = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      if (!r.content_text) continue;
      const cleaned = stripHtmlTags(r.content_text);
      if (cleaned !== r.content_text) {
        const excerpt = cleaned.replace(/\s+/g, ' ').trim().slice(0, 300);
        upd.run(cleaned, excerpt || null, r.id);
        changed++;
      }
    }
  });
  tx();

  db.exec("INSERT INTO docs_fts(docs_fts) VALUES('rebuild')");
  console.log(`Cleaned ${changed} doc_pages. docs_fts rebuilt. (re-embed picks up changed content on next embed run)`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
