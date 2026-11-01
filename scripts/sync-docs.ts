import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDb } from '../lib/db';
import { guardSync } from '../lib/sync-log';
import { marked } from 'marked';
import { isEntrypoint } from '../lib/is-entrypoint';
import { SITE } from '../lib/site.config';

// NEAR ships its ENTIRE docs site as one cleaned-markdown file for LLM
// ingestion. Each page is a block:
//
//   ---
//   Title: <page title>
//   URL: https://docs.yourchain.example/<path>.md
//   Source: app/<path>/page.mdx
//   ---
//
//   <page markdown content...>
//
// We split on that 5-line header (matched precisely so in-content `---`
// horizontal rules / frontmatter don't false-trigger), then upsert one
// doc_pages row per block with source='docs'.
// Exported so check-completeness.ts counts pages from the same feed this
// sync reads, rather than a second copy that can drift from it.
export const LLMS_URL = 'https://docs.yourchain.example/llms-full.txt';

// Matches the header block and captures Title / URL / Source. The `m` flag
// anchors ^/$ to line boundaries so a bare `---` inside page content (which
// is NOT immediately followed by `Title:`) can never match.
export const HEADER_RE = /^---\nTitle:\s*(.+)\nURL:\s*(.+)\nSource:\s*(.+)\n---$/gm;

interface DocPage {
  url: string;          // canonical docs.yourchain.example URL (no .md)
  title: string;
  breadcrumb: string | null;
  excerpt: string | null;
  content_text: string; // page markdown
  content_html: string; // rendered markdown
}

// docs.yourchain.example/build/contracts/integrate.md
//   -> https://docs.yourchain.example/build/contracts/integrate
// docs.yourchain.example/index.md
//   -> https://docs.yourchain.example/index   (matches existing seeded row)
function canonicalizeUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/\.md$/i, '');
}

// build/contracts/integrate
//   -> "build › contracts › integrate"
// index -> "index"
function breadcrumbFromUrl(canonicalUrl: string): string | null {
  let path: string;
  try {
    path = new URL(canonicalUrl).pathname;
  } catch {
    return null;
  }
  const segments = path
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/-/g, ' '));
  if (segments.length === 0) return null;
  return segments.join(' › ');
}

function parsePages(text: string): DocPage[] {
  // Find every header block with its position so we can slice the content
  // that follows it (up to the next header, or EOF).
  const headers: { title: string; url: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  HEADER_RE.lastIndex = 0;
  while ((m = HEADER_RE.exec(text)) !== null) {
    headers.push({
      title: m[1].trim(),
      url: m[2].trim(),
      start: m.index,
      end: HEADER_RE.lastIndex, // index just past the closing `---`
    });
  }

  const pages: DocPage[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const contentStart = h.end;
    const contentEnd = i + 1 < headers.length ? headers[i + 1].start : text.length;
    // content_text is the raw markdown slice, embedded/indexed verbatim -
    // unlike content_html (rendered via marked.parse() below and sanitized
    // before display, which already drops <style>/<script>), nothing stood
    // between this and search/RAG. One page's source markdown embeds a
    // Docusaurus "hide the Copy Page button" <style>{...}</style> JSX block,
    // and that raw CSS (`display: none !important`, class selectors) was
    // being chunked and embedded as if it were prose - confirmed isolated to
    // that one page via a LIKE scan, but stripped unconditionally since nothing
    // legitimate in this corpus is a <style> or <script> block.
    const content_text = text.slice(contentStart, contentEnd)
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .trim();
    if (!content_text) continue;

    const url = canonicalizeUrl(h.url);
    if (!url.startsWith('https://docs.yourchain.example/')) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    const content_html = marked.parse(content_text, { async: false }) as string;
    // Excerpt: first ~200 chars of human-readable text. Strip leading markdown
    // heading hashes / bold markers so the snippet reads cleanly.
    const plain = content_text
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/[*_`>#]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const excerpt = plain.slice(0, 200) || null;

    pages.push({
      url,
      title: h.title || url,
      breadcrumb: breadcrumbFromUrl(url),
      excerpt,
      content_text,
      content_html,
    });
  }

  return pages;
}

async function syncDocs(): Promise<void> {
  console.log('Syncing NEAR docs from', LLMS_URL);

  const res = await fetch(LLMS_URL, {
    headers: { 'User-Agent': `${SITE.name}-Bot/1.0` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${LLMS_URL}: ${res.status} ${res.statusText}`);
  }
  // HTTP's Last-Modified header is always RFC 2822 ("Tue, 01 Sep 2026
  // 16:41:17 GMT"), never ISO-8601. Stored verbatim, that shape survives V8's
  // Date.parse (which reads RFC 2822 fine) but not SQLite's date functions,
  // which do not - check-formats' G2 caught the resulting split live. Every
  // other *_at/*_date column in this schema is ISO; normalizing here at the
  // source keeps that true instead of teaching every reader a second format.
  const lastModifiedRaw = res.headers.get('last-modified');
  const lastModifiedHeader = lastModifiedRaw ? new Date(lastModifiedRaw).toISOString() : null;
  const text = await res.text();
  console.log(`Fetched ${text.length} bytes (last-modified: ${lastModifiedHeader ?? 'n/a'})`);

  const pages = parsePages(text);
  console.log(`Parsed ${pages.length} doc pages`);
  if (pages.length === 0) {
    throw new Error('No pages parsed - aborting before touching the DB');
  }

  const db = getDb();
  const now = new Date().toISOString();

  // ON CONFLICT(url), not INSERT OR REPLACE: REPLACE deletes the row and
  // inserts a fresh one, so any column this file doesn't fetch reverts to its
  // default. `environment` is derived once by a migration (lib/db.ts) from the
  // URL and never re-derived here - REPLACE was resetting it to NULL for every
  // row this sync touches, which is every 'docs'-source row every 6 hours.
  // We only ever touch source='docs' rows: repo-doc pages (yourchain-app, rpc,
  // adr, ...) live under different URLs that never appear in this file, so
  // they are left untouched either way.
  const upsert = db.prepare(`
    INSERT INTO doc_pages
      (url, title, breadcrumb, excerpt, content_text, content_html, source, last_modified, synced_at)
    VALUES
      (@url, @title, @breadcrumb, @excerpt, @content_text, @content_html, 'docs', @last_modified, @synced_at)
    ON CONFLICT(url) DO UPDATE SET
      title = excluded.title,
      breadcrumb = excluded.breadcrumb,
      excerpt = excluded.excerpt,
      content_text = excluded.content_text,
      content_html = excluded.content_html,
      last_modified = excluded.last_modified,
      synced_at = excluded.synced_at
  `);

  const writeAll = db.transaction((rows: DocPage[]) => {
    let inserted = 0;
    let updated = 0;
    for (const p of rows) {
      const existing = db
        .prepare("SELECT 1 FROM doc_pages WHERE url = ? AND source = 'docs'")
        .get(p.url);
      upsert.run({
        url: p.url,
        title: p.title,
        breadcrumb: p.breadcrumb,
        excerpt: p.excerpt,
        content_text: p.content_text,
        content_html: p.content_html,
        last_modified: lastModifiedHeader,
        synced_at: now,
      });
      if (existing) updated++;
      else inserted++;
    }
    return { inserted, updated };
  });

  const { inserted, updated } = writeAll(pages);
  console.log(`Wrote ${pages.length} rows (inserted=${inserted}, updated=${updated})`);

  // Prune pages that disappeared upstream. Without this, deleted docs are
  // served forever - including to AI agents over MCP.
  //
  // Scope by URL NAMESPACE, not by source: other ingests also write
  // source='docs' rows (e.g. github.com/yoursdk/docs/...) that this file never
  // lists, so a bare `DELETE ... WHERE source='docs'` would destroy them.
  // `pages.length === 0` already threw above, so we can never wipe on a bad fetch.
  // Namespace alone is still not proof of ownership: hand-seeded rows live under
  // docs.yourchain.example too (e.g. .../SKILL.md, the canonical agent guidance).
  // canonicalizeUrl strips `.md`, so a `.md` URL can never come from this parser
  // - which makes it a reliable "not mine, don't touch" marker.
  const liveUrls = new Set(pages.map(p => p.url));
  const stale = db
    .prepare(
      "SELECT url FROM doc_pages WHERE source = 'docs' " +
      "AND url LIKE 'https://docs.yourchain.example/%' AND url NOT LIKE '%.md'",
    )
    .all() as { url: string }[];
  const toDelete = stale.filter(r => !liveUrls.has(r.url)).map(r => r.url);
  // Last line of defence: a partial upstream parse looks exactly like "these
  // pages were unpublished". Deleting a large share of the corpus is never a
  // legitimate outcome of one sync, so refuse and let a human look.
  const pruneRatio = stale.length > 0 ? toDelete.length / stale.length : 0;
  if (toDelete.length > 0 && pruneRatio > 0.2) {
    console.error(
      `[sync-docs] REFUSING to prune ${toDelete.length}/${stale.length} pages ` +
      `(${Math.round(pruneRatio * 100)}%) - upstream parse looks incomplete. No rows deleted.`,
    );
    process.exitCode = 1;
  } else if (toDelete.length > 0) {
    const del = db.prepare('DELETE FROM doc_pages WHERE url = ?');
    db.transaction((urls: string[]) => { for (const u of urls) del.run(u); })(toDelete);
    console.log(`Pruned ${toDelete.length} doc pages no longer published upstream`);
  }

  // Rebuild the FTS index (external-content table) so search picks up the
  // new/changed content.
  db.prepare("INSERT INTO docs_fts(docs_fts) VALUES('rebuild')").run();
  console.log('docs_fts rebuilt');

  db.prepare(
    'INSERT INTO sync_log (source, status, items_synced, ran_at) VALUES (?, ?, ?, ?)'
  ).run('docs', 'success', pages.length, now);

  const total = (db.prepare("SELECT COUNT(*) c FROM doc_pages WHERE source='docs'").get() as { c: number }).c;
  console.log(`Done: ${pages.length} docs pages synced (source='docs' total now ${total}).`);
}

// isEntrypoint, not a bare call: check-completeness.ts imports LLMS_URL and
// HEADER_RE above so its own count reads the same feed this sync parses.
// Without this guard, that import ran the whole sync against the live
// database - discovered empirically on 2026-08-02 when check-completeness.ts's
// first run did exactly that.
if (isEntrypoint(import.meta.url)) {
  guardSync('docs', syncDocs).catch((err) => {
    console.error('Docs sync failed:', err);
    process.exit(1);
  });
}
