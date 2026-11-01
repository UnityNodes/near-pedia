// Import a PDF from the local filesystem into the whitepapers table.
// Used when the source is paywalled / bot-protected and the only way to get
// the file is to download it manually and drop it on the server.
//
// Usage:
//   npx tsx scripts/import-pdf-local.ts \
//     --file=/srv/yourpedia/<path>.pdf \
//     --slug=<slug> \
//     --title="<Title>" \
//     [--tag=<tag>] [--source=<url>] [--description="<...>"]

import fs from 'fs';
import { createRequire } from 'module';
import { getDb } from '../lib/db';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages: number }>;

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit?.slice(prefix.length);
}

async function main() {
  const file = arg('file');
  const slug = arg('slug');
  const title = arg('title');
  const tag = arg('tag') ?? 'External';
  const source = arg('source') ?? '';
  const description = arg('description') ?? '';

  if (!file || !slug || !title) {
    console.error('Usage: --file=<path> --slug=<slug> --title="<Title>" [--tag=<tag>] [--source=<url>] [--description="<...>"]');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  const buf = fs.readFileSync(file);
  console.log(`Parsing PDF (${(buf.length / 1024 / 1024).toFixed(1)} MB)...`);
  const parsed = await pdfParse(buf);
  const text = parsed.text.replace(/\s+/g, ' ').trim();
  console.log(`  ${parsed.numpages} pages, ${text.length} chars extracted.`);

  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO whitepapers (slug, title, description, tag, pdf_url, content_text, pages, synced_at)
    VALUES (@slug, @title, @description, @tag, @pdf_url, @content_text, @pages, @synced_at)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      tag = excluded.tag,
      pdf_url = excluded.pdf_url,
      content_text = excluded.content_text,
      pages = excluded.pages,
      synced_at = excluded.synced_at
  `).run({
    slug, title, description, tag,
    pdf_url: source,
    content_text: text,
    pages: parsed.numpages,
    synced_at: now,
  });

  db.prepare("INSERT INTO whitepapers_fts(whitepapers_fts) VALUES('rebuild')").run();
  console.log(`✓ Stored as whitepaper "${slug}". FTS rebuilt.`);
  console.log(`  Next: npx tsx scripts/build-embeddings.ts  # to index the new content into RAG`);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
