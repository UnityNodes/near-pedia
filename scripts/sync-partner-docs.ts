/**
 * Partner documentation (lib/partners.ts, the partners with a docs_feed:
 * a Mintlify llms-full.txt, or one single-document llms.txt) into doc_pages under source='partner-docs', one URL namespace
 * per partner origin. Same parser and the same removal rule as sync-docs: a
 * page is removed only when its feed stops announcing it, through
 * pruneConfirmingUrls, scoped to that partner's origin so one partner's
 * outage cannot touch another's pages.
 *
 * Kept apart from source='docs', which is docs.near.org alone: completeness,
 * refusals and the deprecation engine read that source as NEAR's own word.
 *
 *   npx tsx scripts/sync-partner-docs.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { marked } from 'marked';
import { getDb } from '../lib/db';
import { guardSync, logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { SITE } from '../lib/site.config';
import { politeFetch } from '../lib/polite-fetch';
import { prune } from '../lib/prune';
import { pruneConfirmingUrls } from '../lib/confirm-gone';
import { announcedUrls, diffPages, expandOpenApiPages, parseLlmsFull, singleDocPage, type NearDocPage } from '../lib/near-docs';
import { fetchSpec } from '../lib/openapi-fetch';
import { recordEvents, type ChangeEvent } from '../lib/change-events';
import { PARTNERS, type Partner } from '../lib/partners';

const UA = `${SITE.slug}-sync/1.0 (+${SITE.publisher.url})`;
const MAX_PRUNE_RATIO = 0.2;
const SOURCE = 'partner-docs';

async function syncPartner(p: Partner, feed: NonNullable<Partner['docs_feed']>, now: string): Promise<{ pages: number; problem: string | null }> {
  const r = await politeFetch(feed.url, { userAgent: UA, timeoutMs: 60_000 });
  if (r.kind !== 'ok') return { pages: 0, problem: `${feed.url}: ${r.kind}` };
  const text = await r.res.text();
  const parsed = feed.single ? [singleDocPage(text, feed.url)].filter((pg): pg is NearDocPage => pg !== null) : parseLlmsFull(text, feed.origin);
  const { pages, problems: specProblems } = await expandOpenApiPages(parsed, feed.origin, (url) => fetchSpec(url, UA));
  const announced = feed.single ? pages.map((pg) => pg.url) : announcedUrls(text, feed.origin);
  if (pages.length === 0) return { pages: 0, problem: `${feed.url}: no pages parsed` };

  const db = getDb();
  const namespace = `${feed.origin}/%`;
  const stored = db.prepare('SELECT url, title, content_hash FROM doc_pages WHERE source = ? AND url LIKE ?')
    .all(SOURCE, namespace) as Array<{ url: string; title: string | null; content_hash: string | null }>;
  const hashOf = new Map(pages.map((pg) => [pg.url, pg.content_hash]));
  const events: ChangeEvent[] = diffPages(stored, pages).map((c) => ({
    kind: c.kind,
    subject: `doc:${c.url}`,
    title: `${c.kind === 'doc_added' ? 'New' : 'Rewritten'} ${p.name} docs page: ${c.title}`,
    detail: { partner: p.id },
    source_url: c.url,
    key: c.kind === 'doc_changed' ? hashOf.get(c.url)! : 'added',
  }));
  const upsert = db.prepare(`
    INSERT INTO doc_pages (url, title, breadcrumb, excerpt, content_text, content_html, source, last_modified, synced_at, content_hash)
    VALUES (@url, @title, @breadcrumb, @excerpt, @content_text, @content_html, '${SOURCE}', @synced_at, @synced_at, @content_hash)
    ON CONFLICT(url) DO UPDATE SET
      title = excluded.title, breadcrumb = excluded.breadcrumb, excerpt = excluded.excerpt,
      content_text = excluded.content_text, content_html = excluded.content_html,
      last_modified = CASE WHEN doc_pages.content_hash IS excluded.content_hash THEN doc_pages.last_modified ELSE excluded.last_modified END,
      synced_at = excluded.synced_at, content_hash = excluded.content_hash
  `);
  db.transaction((rows: NearDocPage[]) => {
    for (const pg of rows) upsert.run({ ...pg, title: pg.title === p.name ? pg.title : `${p.name}: ${pg.title}`, content_html: marked.parse(pg.content_text, { async: false }) as string, synced_at: now });
    recordEvents(db, events, now);
  })(pages);

  const { result, report } = await pruneConfirmingUrls(
    {
      table: 'doc_pages',
      keyColumn: 'url',
      scopeColumn: 'source',
      scopeValue: SOURCE,
      scopeWhere: `url LIKE '${namespace}'`,
      liveKeys: announced,
      maxDeleteRatio: MAX_PRUNE_RATIO,
      clearReferences: (tx, doomed) => {
        const gone = tx.prepare(`SELECT d.url, d.title FROM doc_pages d JOIN ${doomed} g ON g.k = d.url`).all() as Array<{ url: string; title: string | null }>;
        recordEvents(tx, gone.map((g) => ({
          kind: 'doc_removed' as const,
          subject: `doc:${g.url}`,
          title: `Removed ${p.name} docs page: ${g.title ?? g.url}`,
          detail: { partner: p.id },
          source_url: g.url,
          key: now,
        })), now);
      },
    },
    (spec) => prune(spec, db),
    { userAgent: UA, delayMs: 300 },
  );
  const pruneProblem = result.refused ? `${p.id} prune refused: ${result.reason}` : report.overCap ? `${p.id}: ${report.candidates} removal candidates over the probe cap` : null;
  const problem = [pruneProblem, ...specProblems.map((s) => `${p.id}: ${s}`)].filter(Boolean).join(' ; ') || null;
  console.log(`[sync-partner-docs] ${p.id}: ${pages.length} pages, ${result.deleted} removed, ${events.length} change events`);
  return { pages: pages.length, problem };
}

async function main(): Promise<void> {
  const now = new Date().toISOString();
  let total = 0;
  const problems: string[] = [];
  for (const p of PARTNERS) {
    if (!p.docs_feed) continue;
    try {
      const r = await syncPartner(p, p.docs_feed, now);
      total += r.pages;
      if (r.problem) problems.push(r.problem);
    } catch (e) {
      problems.push(`${p.id}: ${(e as Error).message}`);
    }
  }
  const db = getDb();
  db.prepare("INSERT INTO docs_fts(docs_fts) VALUES('rebuild')").run();
  if (total === 0) throw new Error(`no partner docs synced: ${problems.join(' ; ')}`);
  logRun('partner-docs', { status: problems.length ? 'partial' : 'success', items: total, error: problems.join(' ; ') || undefined }, db);
}

if (isEntrypoint(import.meta.url)) {
  guardSync('partner-docs', main).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
