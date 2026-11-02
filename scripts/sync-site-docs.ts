/**
 * Documentation sites read from their sitemap (lib/site-docs.ts: the
 * Nomicon) into doc_pages under their own source. Every listed page is read
 * each run, and a page counts as changed when its text hash does. A page the
 * sitemap stops listing is removed through pruneConfirmingUrls, scoped to
 * that site's source.
 *
 * A listed page that redirects off the site is not the site's page: on
 * 2026-11-02, 23 of the Nomicon's standards pages redirected to the NEP
 * files on GitHub (served by get_standard from sync-neps) or to the NEPs
 * landing page. Stored under the nomicon.io URL they would pass GitHub's
 * page chrome off as first-party spec text, and the 404 probe of
 * pruneConfirmingUrls follows the redirect and sees a 200, so such a row is
 * removed here directly. A listed page that answers 404 (24 that day) is
 * skipped the same way.
 *
 *   npx tsx scripts/sync-site-docs.ts
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
import { diffPages, type NearDocPage } from '../lib/near-docs';
import { recordEvents, type ChangeEvent } from '../lib/change-events';
import { SITE_DOCS, parseSiteDoc, siteDocUrls, type SiteDocs } from '../lib/site-docs';

const UA = `${SITE.slug}-sync/1.0 (+${SITE.publisher.url})`;
const PACE_MS = 300;
const MAX_PRUNE_RATIO = 0.2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function text(url: string): Promise<string | null> {
  const r = await politeFetch(url, { userAgent: UA, timeoutMs: 30_000 });
  return r.kind === 'ok' ? r.res.text() : null;
}

type Fetched = { kind: 'page'; html: string } | { kind: 'gone' } | { kind: 'moved'; to: string } | { kind: 'unreadable'; why: string };

async function page(url: string, origin: string): Promise<Fetched> {
  try {
    const r = await politeFetch(url, { userAgent: UA, timeoutMs: 30_000 });
    if (r.kind === 'not-found') return { kind: 'gone' };
    if (r.kind !== 'ok') return { kind: 'unreadable', why: r.kind };
    const landed = r.res.url || url;
    if (new URL(landed).origin !== origin) return { kind: 'moved', to: landed };
    return { kind: 'page', html: await r.res.text() };
  } catch (e) {
    return { kind: 'unreadable', why: (e as Error).message };
  }
}

async function syncSite(site: SiteDocs, now: string, problems: string[]): Promise<number> {
  const xml = await text(site.sitemap);
  const urls = xml ? siteDocUrls(xml, site) : [];
  if (urls.length === 0) {
    problems.push(`${site.source}: sitemap listed no pages`);
    return 0;
  }
  const pages: NearDocPage[] = [];
  const moved: string[] = [];
  let unreadable = 0;
  let gone = 0;
  for (const url of urls) {
    await sleep(PACE_MS);
    const got = await page(url, site.origin);
    if (got.kind === 'gone') { gone++; continue; }
    if (got.kind === 'moved') { moved.push(url); continue; }
    const parsed = got.kind === 'page' ? parseSiteDoc(got.html, url, site) : null;
    if (parsed) pages.push(parsed); else unreadable++;
  }
  if (unreadable) problems.push(`${site.source}: ${unreadable} of ${urls.length} pages unreadable`);

  const db = getDb();
  const stored = db.prepare('SELECT url, title, content_hash FROM doc_pages WHERE source = ?').all(site.source) as Array<{ url: string; title: string | null; content_hash: string | null }>;
  const hashOf = new Map(pages.map((pg) => [pg.url, pg.content_hash]));
  const events: ChangeEvent[] = diffPages(stored, pages).map((c) => ({
    kind: c.kind,
    subject: `doc:${c.url}`,
    title: `${c.kind === 'doc_added' ? 'New' : 'Rewritten'} ${site.label} page: ${c.title}`,
    detail: { source: site.source },
    source_url: c.url,
    key: c.kind === 'doc_changed' ? hashOf.get(c.url)! : 'added',
  }));
  const upsert = db.prepare(`
    INSERT INTO doc_pages (url, title, breadcrumb, excerpt, content_text, content_html, source, last_modified, synced_at, content_hash)
    VALUES (@url, @title, @breadcrumb, @excerpt, @content_text, @content_html, @source, @synced_at, @synced_at, @content_hash)
    ON CONFLICT(url) DO UPDATE SET
      title = excluded.title, breadcrumb = excluded.breadcrumb, excerpt = excluded.excerpt,
      content_text = excluded.content_text, content_html = excluded.content_html, source = excluded.source,
      last_modified = CASE WHEN doc_pages.content_hash IS excluded.content_hash THEN doc_pages.last_modified ELSE excluded.last_modified END,
      synced_at = excluded.synced_at, content_hash = excluded.content_hash
  `);
  const movedHeld = stored.filter((r) => moved.includes(r.url));
  const dropMoved = db.prepare('DELETE FROM doc_pages WHERE source = ? AND url = ?');
  db.transaction((rows: NearDocPage[]) => {
    for (const pg of rows) upsert.run({ ...pg, source: site.source, content_html: marked.parse(pg.content_text, { async: false }) as string, synced_at: now });
    for (const r of movedHeld) dropMoved.run(site.source, r.url);
    recordEvents(db, [...events, ...movedHeld.map((r) => ({
      kind: 'doc_removed' as const,
      subject: `doc:${r.url}`,
      title: `Removed ${site.label} page: ${r.title ?? r.url} (now redirects off the site)`,
      detail: { source: site.source },
      source_url: r.url,
      key: now,
    }))], now);
  })(pages);

  const { result, report } = await pruneConfirmingUrls(
    {
      table: 'doc_pages',
      keyColumn: 'url',
      scopeColumn: 'source',
      scopeValue: site.source,
      liveKeys: pages.map((pg) => pg.url),
      maxDeleteRatio: MAX_PRUNE_RATIO,
      clearReferences: (tx, doomed) => {
        const gone = tx.prepare(`SELECT d.url, d.title FROM doc_pages d JOIN ${doomed} g ON g.k = d.url`).all() as Array<{ url: string; title: string | null }>;
        recordEvents(tx, gone.map((g) => ({
          kind: 'doc_removed' as const,
          subject: `doc:${g.url}`,
          title: `Removed ${site.label} page: ${g.title ?? g.url}`,
          detail: { source: site.source },
          source_url: g.url,
          key: now,
        })), now);
      },
    },
    (spec) => prune(spec, db),
    { userAgent: UA, delayMs: PACE_MS },
  );
  if (result.refused) problems.push(`${site.source} prune refused: ${result.reason}`);
  else if (report.overCap) problems.push(`${site.source}: ${report.candidates} removal candidates over the probe cap`);
  console.log(`[sync-site-docs] ${site.source}: ${pages.length} pages, ${gone} listed but 404, ${moved.length} redirecting off the site, ${result.deleted + movedHeld.length} removed, ${events.length} change events`);
  return pages.length;
}

async function main(): Promise<void> {
  const now = new Date().toISOString();
  const problems: string[] = [];
  let total = 0;
  for (const site of SITE_DOCS) {
    try {
      total += await syncSite(site, now, problems);
    } catch (e) {
      problems.push(`${site.source}: ${(e as Error).message}`);
    }
  }
  const db = getDb();
  db.prepare("INSERT INTO docs_fts(docs_fts) VALUES('rebuild')").run();
  if (total === 0) throw new Error(`no site docs synced: ${problems.join(' ; ')}`);
  logRun('site-docs', { status: problems.length ? 'partial' : 'success', items: total, error: problems.join(' ; ') || undefined }, db);
  for (const p of problems) console.warn(`  ${p}`);
}

if (isEntrypoint(import.meta.url)) {
  guardSync('site-docs', main).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
