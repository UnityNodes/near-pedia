/**
 * npm and crates.io state for the NEAR packages in lib/near-sources.ts:
 * latest and latest-stable version with dates, per-version deprecation and
 * yank flags, and the repository link that joins a package to github_repos.
 * What changed since the last run goes to change_events.
 *
 * crates.io asks for one request a second and a User-Agent that names a
 * contact; npm has no published limit, so both get the same polite pace.
 *
 *   npx tsx scripts/sync-packages.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDb } from '../lib/db';
import { guardSync, logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { SITE } from '../lib/site.config';
import { HttpError, politeGetJson } from '../lib/polite-fetch';
import { CRATES, NPM_PACKAGES, NPM_SCOPES } from '../lib/near-sources';
import { diffPackage, fromCrates, fromNpm, packageId, type PackageSnapshot } from '../lib/registry-packages';
import { knownScopePackages, loadPackage, savePackage } from '../lib/packages-store';
import { recordEvents, type ChangeEvent } from '../lib/change-events';

const UA = `${SITE.slug}-sync/1.0 (+${SITE.publisher.url})`;
const PACE_MS = 1_000;
const SEARCH_SIZE = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface NpmSearch { objects?: Array<{ package?: { name?: string } }> }

/**
 * npm search has no exact scope filter (`scope:near-js` returned unrelated
 * packages on 2026-11-01), so the scope name is the query and the prefix is
 * the filter.
 */
export async function discoverScope(scope: string): Promise<string[]> {
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(scope)}&size=${SEARCH_SIZE}`;
  const body = await politeGetJson<NpmSearch>(url, { userAgent: UA });
  const names = (body?.objects ?? []).map((o) => o.package?.name).filter((n): n is string => !!n && n.startsWith(`${scope}/`));
  return [...new Set(names)].sort();
}

interface Target { registry: 'npm' | 'crates'; name: string; discoveredBy: string }

async function targets(problems: string[]): Promise<Target[]> {
  const db = getDb();
  const out: Target[] = NPM_PACKAGES.map((name) => ({ registry: 'npm' as const, name, discoveredBy: 'list' }));
  for (const scope of NPM_SCOPES) {
    let names: string[];
    try {
      names = await discoverScope(scope);
    } catch (e) {
      names = [];
      problems.push(`npm search ${scope}: ${(e as Error).message}`);
    }
    if (names.length === 0) {
      names = knownScopePackages(db, scope);
      if (names.length) problems.push(`npm search ${scope}: no results, kept ${names.length} known packages`);
    }
    for (const name of names) {
      if (!out.some((t) => t.registry === 'npm' && t.name === name)) out.push({ registry: 'npm', name, discoveredBy: `scope:${scope}` });
    }
    await sleep(PACE_MS);
  }
  for (const name of CRATES) out.push({ registry: 'crates', name, discoveredBy: 'list' });
  return out;
}

async function fetchSnapshot(t: Target): Promise<PackageSnapshot | null> {
  if (t.registry === 'npm') {
    const doc = await politeGetJson<Parameters<typeof fromNpm>[0]>(`https://registry.npmjs.org/${t.name.replace('/', '%2F')}`, { userAgent: UA });
    return doc ? fromNpm(doc) : null;
  }
  const doc = await politeGetJson<Parameters<typeof fromCrates>[0]>(`https://crates.io/api/v1/crates/${encodeURIComponent(t.name)}`, { userAgent: UA });
  return doc ? fromCrates(doc) : null;
}

async function main(): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const problems: string[] = [];
  const list = await targets(problems);

  let written = 0;
  let failed = 0;
  let recorded = 0;
  const blocked = new Set<string>();
  for (const t of list) {
    if (blocked.has(t.registry)) {
      failed++;
      continue;
    }
    try {
      const snap = await fetchSnapshot(t);
      if (!snap) {
        problems.push(`${packageId(t.registry, t.name)}: not found`);
        continue;
      }
      // The snapshot and its change events commit together, so a run killed
      // between the two cannot save a yank as the stored state while losing
      // the event that reports it.
      const events: ChangeEvent[] = diffPackage(loadPackage(db, snap.id), snap);
      db.transaction(() => {
        savePackage(db, snap, t.discoveredBy, now);
        recorded += recordEvents(db, events, now);
      })();
      written++;
    } catch (e) {
      failed++;
      problems.push(`${packageId(t.registry, t.name)}: ${(e as Error).message}`);
      if (e instanceof HttpError && e.rateLimited) {
        blocked.add(t.registry);
        problems.push(`${t.registry}: rate limited, the rest of its packages skipped this run`);
      }
    } finally {
      await sleep(PACE_MS);
    }
  }

  const status = written === 0 ? 'error' : failed > 0 || problems.length > 0 ? 'partial' : 'success';
  logRun('packages', { status, items: written, error: problems.length ? problems.join(' ; ').slice(0, 1000) : undefined }, db);
  console.log(`[sync-packages] ${written}/${list.length} packages written, ${recorded} change events${problems.length ? `; ${problems.length} problems` : ''}`);
  for (const p of problems) console.warn(`  ${p}`);
  if (status === 'error') process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  guardSync('packages', main).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
