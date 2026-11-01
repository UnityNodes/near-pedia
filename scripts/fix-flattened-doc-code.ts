import { getDb } from '../lib/db';
import { htmlToTextWithCode } from '../lib/html-extract';

// One-time: repair doc_pages rows whose content_text was flattened by
// cleanup-doc-html.ts's old `.replace(/\s+/g, ' ')` (fixed alongside this
// script - see its header). content_html was never touched by that bug, so
// it is still the correct source of truth; re-derive content_text from it
// with the same htmlToTextWithCode() converter the live doc syncs use, which
// keeps <pre> blocks as fenced, newline-intact code.
//
// Detection matches check-doc-structure.ts exactly: a page whose HTML holds a
// real multi-line <pre> block (a newline or <br> inside, >40 chars of text)
// but whose stored content_text has no newline at all.

function multilinePreCount(html: string): number {
  let n = 0;
  for (const m of html.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi)) {
    const inner = m[1];
    const looksMultiline = /\n/.test(inner) || /<br\b/i.test(inner);
    const textLen = inner.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').trim().length;
    if (looksMultiline && textLen > 40) n++;
  }
  return n;
}

function main(): void {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, url, content_html, content_text FROM doc_pages
     WHERE content_html IS NOT NULL AND content_text IS NOT NULL`,
  ).all() as Array<{ id: number; url: string; content_html: string; content_text: string }>;

  const upd = db.prepare('UPDATE doc_pages SET content_text = ?, excerpt = ? WHERE id = ?');
  let fixed = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      if (multilinePreCount(r.content_html) === 0) continue;
      if (r.content_text.includes('\n')) continue;
      const restored = htmlToTextWithCode(r.content_html);
      if (!restored.includes('\n')) continue; // converter found nothing to restore; leave it
      const excerpt = restored.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      upd.run(restored, excerpt || null, r.id);
      fixed++;
      console.log(`  fixed  ${r.url}`);
    }
  });
  tx();

  db.exec("INSERT INTO docs_fts(docs_fts) VALUES('rebuild')");
  console.log(`Restored ${fixed} flattened doc page(s). docs_fts rebuilt. (re-embed picks up changed content on next embed run)`);
}

main();
