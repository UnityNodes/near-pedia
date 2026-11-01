/**
 * The NEAR ecosystem from NEAR Catalog (api.nearcatalog.xyz) into
 * ecosystem_projects, the table /ecosystem, find_project and
 * check-ecosystem-liveness read, with TVL on NEAR from DefiLlama.
 *
 * The list carries name, tags, phase and an updated_date per project; the
 * website, GitHub, tokens and full description are only in each project's
 * detail document. A detail is fetched again when the list says the project
 * changed, or when ours is older than DETAIL_MAX_AGE_DAYS, so a run after
 * the first reads a handful of details, not 340.
 *
 * The upsert names only the columns this sync owns: the liveness columns
 * belong to check-ecosystem-liveness, and a REPLACE here once reset them on
 * every run.
 *
 *   npx tsx scripts/sync-ecosystem.ts
 */

import 'dotenv/config';
import { guardSync, logRun } from '../lib/sync-log';
import { getDb } from '../lib/db';
import { isEntrypoint } from '../lib/is-entrypoint';
import { SITE } from '../lib/site.config';
import { politeGetJson } from '../lib/polite-fetch';
import { recordEvents } from '../lib/change-events';
import {
  CATALOG_DETAIL_URL, CATALOG_LIST_URL, CATALOG_PAGE_URL, PROTOCOLS_URL, SLUG_RE, fromCatalog, tagCounts, tvlByProject,
  type CatalogList, type CatalogProject, type Profile, type RawProtocol,
} from '../lib/near-catalog';

/** Exported so check-completeness.ts counts the same list this sync reads. */
export const SRC = CATALOG_LIST_URL;

const UA = `${SITE.slug}-sync/1.0 (+${SITE.publisher.url})`;
const DETAIL_MAX_AGE_DAYS = 30;
const DETAIL_CONCURRENCY = 4;
const MIN_LIST_SIZE = 100;
/** DefiLlama listed 46 protocols with TVL on NEAR on 2026-11-01; a list far shorter is a broken answer. */
const MIN_PROTOCOLS = 1000;
const SOURCE = 'nearcatalog.xyz';

interface Stored { slug: string; catalog_updated_at: string | null; detail_synced_at: string | null; website: string | null }

function needsDetail(p: CatalogProject, s: Stored | undefined, now: number): boolean {
  if (!s?.detail_synced_at) return true;
  if (p.catalog_updated_at !== s.catalog_updated_at) return true;
  return now - Date.parse(s.detail_synced_at) > DETAIL_MAX_AGE_DAYS * 86_400_000;
}

async function fetchDetails(slugs: readonly string[]): Promise<{ details: Map<string, Profile>; failed: string[] }> {
  const details = new Map<string, Profile>();
  const failed: string[] = [];
  const queue = [...slugs];
  await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, async () => {
    for (let slug = queue.shift(); slug; slug = queue.shift()) {
      try {
        const d = await politeGetJson<{ profile?: Profile }>(CATALOG_DETAIL_URL(slug), { userAgent: UA, timeoutMs: 30_000 });
        if (d?.profile?.name) details.set(slug, d.profile);
        else failed.push(slug);
      } catch (e) {
        console.warn(`[sync-ecosystem] detail ${slug}: ${(e as Error).message}`);
        failed.push(slug);
      }
    }
  }));
  return { details, failed };
}

async function fetchProtocols(): Promise<RawProtocol[] | null> {
  try {
    const p = await politeGetJson<RawProtocol[]>(PROTOCOLS_URL, { userAgent: UA, timeoutMs: 60_000 });
    return Array.isArray(p) && p.length >= MIN_PROTOCOLS ? p : null;
  } catch (e) {
    console.warn(`[sync-ecosystem] ${PROTOCOLS_URL}: ${(e as Error).message}`);
    return null;
  }
}

async function main(): Promise<number> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const list = await politeGetJson<CatalogList>(CATALOG_LIST_URL, { userAgent: UA, timeoutMs: 60_000 });
  const entries = list && typeof list === 'object' ? Object.entries(list).filter(([key, e]) => SLUG_RE.test(e?.slug || key)) : [];
  if (entries.length < MIN_LIST_SIZE) throw new Error(`${CATALOG_LIST_URL} returned ${entries.length} projects`);

  const stored = new Map((db.prepare(`SELECT slug, catalog_updated_at, detail_synced_at, website FROM ecosystem_projects WHERE source = ?`).all(SOURCE) as Stored[]).map((s) => [s.slug, s]));
  const firstRun = stored.size === 0;
  const counts = tagCounts(list!);
  const fromList = entries.map(([key, e]) => fromCatalog(e.slug || key, e.profile ?? {}, undefined, counts));
  const want = fromList.filter((p) => needsDetail(p, stored.get(p.slug), Date.now())).map((p) => p.slug);
  const { details, failed } = await fetchDetails(want);
  const listBySlug = new Map(entries.map(([key, e]) => [e.slug || key, e.profile ?? {}]));
  const projects = fromList.map((p) => (details.has(p.slug) ? fromCatalog(p.slug, listBySlug.get(p.slug)!, details.get(p.slug), counts) : p));

  const protocols = await fetchProtocols();
  const joined = protocols ? tvlByProject(protocols, projects.map((p) => ({ slug: p.slug, name: p.name, website: details.has(p.slug) ? p.website : stored.get(p.slug)?.website ?? null }))) : null;
  // No project at all with TVL means the join or the chain key broke, not
  // that NEAR DeFi emptied: keep the last TVL rather than clear it.
  const tvl = joined && joined.size > 0 ? joined : null;

  // A project without a fresh detail keeps the detail columns it had: the
  // list entry alone has no website, and writing its null would unlink TVL
  // and the liveness check from a project whose detail fetch failed once.
  // catalog_updated_at is one of them: it is what needsDetail compares, and
  // taking the list's value after a failed detail skipped the retry for 30 days.
  const upsert = db.prepare(`INSERT INTO ecosystem_projects (slug, title, description, category, url, tags, source, tier, synced_at, logo,
      tagline, website, phase, catalog_status, github, twitter, dapp, tokens, catalog_updated_at, detail_synced_at)
    VALUES (@slug, @title, @description, @category, @url, @tags, '${SOURCE}', 'secondary', @now, @logo,
      @tagline, @website, @phase, @status, @github, @twitter, @dapp, @tokens, @catalog_updated_at, @detail_synced_at)
    ON CONFLICT(slug) DO UPDATE SET title = excluded.title, category = excluded.category, tags = excluded.tags, source = excluded.source,
      synced_at = excluded.synced_at, logo = excluded.logo, tagline = excluded.tagline, phase = excluded.phase,
      catalog_status = excluded.catalog_status,
      catalog_updated_at = CASE WHEN excluded.detail_synced_at IS NOT NULL THEN excluded.catalog_updated_at ELSE ecosystem_projects.catalog_updated_at END,
      description = CASE WHEN excluded.detail_synced_at IS NOT NULL THEN excluded.description ELSE ecosystem_projects.description END,
      url = CASE WHEN excluded.detail_synced_at IS NOT NULL THEN excluded.url ELSE ecosystem_projects.url END,
      website = CASE WHEN excluded.detail_synced_at IS NOT NULL THEN excluded.website ELSE ecosystem_projects.website END,
      github = CASE WHEN excluded.detail_synced_at IS NOT NULL THEN excluded.github ELSE ecosystem_projects.github END,
      twitter = CASE WHEN excluded.detail_synced_at IS NOT NULL THEN excluded.twitter ELSE ecosystem_projects.twitter END,
      dapp = CASE WHEN excluded.detail_synced_at IS NOT NULL THEN excluded.dapp ELSE ecosystem_projects.dapp END,
      tokens = CASE WHEN excluded.detail_synced_at IS NOT NULL THEN excluded.tokens ELSE ecosystem_projects.tokens END,
      detail_synced_at = COALESCE(excluded.detail_synced_at, ecosystem_projects.detail_synced_at)`);
  const setTvl = db.prepare('UPDATE ecosystem_projects SET tvl_usd = ?, tvl_components = ?, tvl_at = ? WHERE slug = ?');
  const clearTvl = db.prepare('UPDATE ecosystem_projects SET tvl_usd = NULL, tvl_components = NULL, tvl_at = ? WHERE source = ?');

  db.transaction(() => {
    for (const p of projects) {
      const fresh = details.has(p.slug);
      upsert.run({
        slug: p.slug, title: p.name, description: p.description ?? p.tagline, category: p.category,
        url: p.website ?? p.dapp ?? CATALOG_PAGE_URL(p.slug), tags: Object.values(listBySlug.get(p.slug)?.tags ?? {}).join(', ') || null,
        now: nowIso, logo: p.logo, tagline: p.tagline, website: p.website, phase: p.phase, status: p.status, github: p.github,
        twitter: p.twitter, dapp: p.dapp, tokens: p.tokens.length ? JSON.stringify(p.tokens) : null,
        catalog_updated_at: p.catalog_updated_at, detail_synced_at: fresh ? nowIso : null,
      });
    }
    if (tvl) {
      clearTvl.run(nowIso, SOURCE);
      for (const [slug, t] of tvl) setTvl.run(t.tvl_usd, JSON.stringify(t.components), nowIso, slug);
    }
    if (!firstRun) {
      recordEvents(db, projects.filter((p) => !stored.has(p.slug)).map((p) => ({
        kind: 'project_added' as const,
        subject: `project:${p.slug}`,
        title: `New in NEAR Catalog: ${p.name}${p.tagline ? `: ${p.tagline}` : ''}`,
        detail: { category: p.category, phase: p.phase },
        source_url: CATALOG_PAGE_URL(p.slug),
        key: p.slug,
      })), nowIso);
    }
  })();

  const partial = failed.length > 0 || !tvl;
  logRun('ecosystem', {
    status: partial ? 'partial' : 'success',
    items: projects.length,
    ...(partial ? { error: [failed.length ? `${failed.length} project details failed` : '', tvl ? '' : 'DefiLlama TVL unavailable or joined to no project, TVL kept from the last run'].filter(Boolean).join('; ') } : {}),
  }, db);
  console.log(`[sync-ecosystem] ${projects.length} projects, ${details.size}/${want.length} details read, ${tvl ? `${tvl.size} with TVL` : 'TVL skipped'}`);
  return projects.length;
}

if (isEntrypoint(import.meta.url)) {
  guardSync('ecosystem', main).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
