/**
 * docs.near.org into doc_pages (source='docs'), from the site's own
 * llms-full.txt. Parsing lives in lib/near-docs.ts.
 *
 * Every page carries a content hash, so a run can tell an added, a rewritten
 * and a removed page apart and record each in change_events. A removed or
 * rewritten docs page is one of the deprecation signals: NEAR retired the
 * NEAR Lake tutorials by deleting the pages, not by marking them.
 *
 * A page is removed only when the feed no longer announces it at all, not
 * when it merely parsed empty, and the removal goes through
 * pruneConfirmingUrls: each candidate is probed, a confirmed 404 is deleted
 * whatever its share, an unconfirmed one only under the ratio guard. The
 * removal events are written in the prune's own transaction, so a row is
 * never deleted without its event or the reverse.
 *
 *   npx tsx scripts/sync-docs.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDb } from '../lib/db';
import { guardSync, logRun } from '../lib/sync-log';
import { marked } from 'marked';
import { isEntrypoint } from '../lib/is-entrypoint';
import { SITE } from '../lib/site.config';
import { politeFetch } from '../lib/polite-fetch';
import { prune } from '../lib/prune';
import { pruneConfirmingUrls } from '../lib/confirm-gone';
import { DOCS_ORIGIN, LLMS_URL, HEADER_RE, announcedUrls, diffPages, expandOpenApiPages, parseLlmsFull, type NearDocPage } from '../lib/near-docs';
import { fetchSpec } from '../lib/openapi-fetch';
import { recordEvents, type ChangeEvent } from '../lib/change-events';

export { LLMS_URL, HEADER_RE };

const UA = `${SITE.slug}-sync/1.0 (+${SITE.publisher.url})`;

/**
 * Unconfirmed deletions above this share of the corpus are refused: that is a
 * cut feed or a parser that stopped matching, not an unpublish.
 */
const MAX_PRUNE_RATIO = 0.2;

const NAMESPACE = `${DOCS_ORIGIN}/%`;

function isoOrNull(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

async function syncDocs(): Promise<void> {
  const r = await politeFetch(LLMS_URL, { userAgent: UA, timeoutMs: 60_000 });
  if (r.kind !== 'ok') throw new Error(`${LLMS_URL}: ${r.kind}`);
  const lastModified = isoOrNull(r.res.headers.get('last-modified'));
  const text = await r.res.text();

  const { pages, problems: specProblems } = await expandOpenApiPages(parseLlmsFull(text), DOCS_ORIGIN, (url) => fetchSpec(url, UA));
  const announced = announcedUrls(text);
  console.log(`[sync-docs] ${text.length} bytes, ${announced.length} pages announced, ${pages.length} with a body (last-modified ${lastModified ?? 'n/a'})`);
  if (pages.length === 0) throw new Error('No pages parsed - aborting before touching the DB');

  const db = getDb();
  const now = new Date().toISOString();
  const stored = db.prepare("SELECT url, title, content_hash FROM doc_pages WHERE source = 'docs' AND url LIKE ?")
    .all(NAMESPACE) as Array<{ url: string; title: string | null; content_hash: string | null }>;
  const changes = diffPages(stored, pages);

  const upsert = db.prepare(`
    INSERT INTO doc_pages (url, title, breadcrumb, excerpt, content_text, content_html, source, last_modified, synced_at, content_hash)
    VALUES (@url, @title, @breadcrumb, @excerpt, @content_text, @content_html, 'docs', @last_modified, @synced_at, @content_hash)
    ON CONFLICT(url) DO UPDATE SET
      title = excluded.title, breadcrumb = excluded.breadcrumb, excerpt = excluded.excerpt,
      content_text = excluded.content_text, content_html = excluded.content_html,
      last_modified = CASE WHEN doc_pages.content_hash IS excluded.content_hash THEN doc_pages.last_modified ELSE excluded.last_modified END,
      synced_at = excluded.synced_at, content_hash = excluded.content_hash
  `);
  const hashOf = new Map(pages.map((p) => [p.url, p.content_hash]));
  const events: ChangeEvent[] = changes.map((c) => ({
    kind: c.kind,
    subject: `doc:${c.url}`,
    title: `${c.kind === 'doc_added' ? 'New' : 'Rewritten'} docs page: ${c.title}`,
    source_url: c.url,
    key: c.kind === 'doc_changed' ? hashOf.get(c.url)! : 'added',
  }));
  let recorded = 0;
  db.transaction((rows: NearDocPage[]) => {
    for (const p of rows) {
      upsert.run({ ...p, content_html: marked.parse(p.content_text, { async: false }) as string, last_modified: lastModified, synced_at: now });
    }
    recorded += recordEvents(db, events, now);
  })(pages);

  let confirmedGone = new Set<string>();
  const { result, report } = await pruneConfirmingUrls(
    {
      table: 'doc_pages',
      keyColumn: 'url',
      scopeColumn: 'source',
      scopeValue: 'docs',
      scopeWhere: `url LIKE '${NAMESPACE}'`,
      liveKeys: announced,
      maxDeleteRatio: MAX_PRUNE_RATIO,
      clearReferences: (tx, doomed) => {
        const gone = tx.prepare(`SELECT d.url, d.title FROM doc_pages d JOIN ${doomed} g ON g.k = d.url`).all() as Array<{ url: string; title: string | null }>;
        recorded += recordEvents(tx, gone.map((g) => ({
          kind: 'doc_removed' as const,
          subject: `doc:${g.url}`,
          title: `Removed docs page: ${g.title ?? g.url}`,
          detail: { confirmed_404: confirmedGone.has(g.url) },
          source_url: g.url,
          key: now,
        })), now);
      },
    },
    (spec) => {
      if (spec.confirmedGone) confirmedGone = new Set(spec.confirmedGone);
      return prune(spec, db);
    },
    { userAgent: UA, delayMs: 300 },
  );

  db.prepare("INSERT INTO docs_fts(docs_fts) VALUES('rebuild')").run();

  const problems: string[] = [...specProblems];
  if (result.refused) problems.push(`prune refused: ${result.reason}`);
  if (report.overCap) problems.push(`${report.candidates} removal candidates, over the probe cap; nothing probed`);
  logRun('docs', { status: problems.length ? 'partial' : 'success', items: pages.length, error: problems.join(' ; ') || undefined }, db);
  console.log(`[sync-docs] ${pages.length} pages written, ${result.deleted} removed (${report.confirmed}/${report.candidates} confirmed 404), ${recorded} change events${problems.length ? `; ${problems.join(' ; ')}` : ''}`);
  if (result.refused) process.exitCode = 1;
}

// isEntrypoint, not a bare call: check-completeness.ts imports LLMS_URL and
// HEADER_RE from here, and a bare call would run the whole sync on import.
if (isEntrypoint(import.meta.url)) {
  guardSync('docs', syncDocs).catch((err) => {
    console.error('Docs sync failed:', err);
    process.exit(1);
  });
}
