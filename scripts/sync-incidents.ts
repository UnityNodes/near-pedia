/**
 * NEAR ecosystem security incidents from DefiLlama's hacks dataset, matched
 * to NEAR Catalog projects (lib/incidents.ts decides what counts). Run after
 * sync-ecosystem so the catalog is there to match against. A new incident
 * after the first run goes to change_events.
 *
 *   npx tsx scripts/sync-incidents.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDb } from '../lib/db';
import { guardSync, logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { SITE } from '../lib/site.config';
import { politeGetJson } from '../lib/polite-fetch';
import { HACKS_URL, selectIncidents, usd, type RawHack } from '../lib/incidents';
import { recordEvents } from '../lib/change-events';
import { parseJson } from '../lib/ecosystem-read';

const UA = `${SITE.slug}-sync/1.0 (+${SITE.publisher.url})`;

async function main(): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const hacks = await politeGetJson<RawHack[]>(HACKS_URL, { userAgent: UA, timeoutMs: 60_000 });
  // The dataset is thousands of entries; an empty or tiny answer is a broken
  // fetch, and reading it as "no incidents" would be the silent kind of wrong.
  if (!Array.isArray(hacks) || hacks.length < 100) throw new Error(`${HACKS_URL} returned ${Array.isArray(hacks) ? hacks.length : 'no'} entries`);
  const catalog = (db.prepare('SELECT slug, title AS name, tags FROM ecosystem_projects').all() as Array<{ slug: string; name: string | null; tags: string | null }>)
    .map((r) => ({ slug: r.slug, name: r.name ?? r.slug, tags: (r.tags ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) }));
  const owners = new Map<string, string>();
  for (const r of db.prepare('SELECT slug, tvl_components FROM ecosystem_projects WHERE tvl_components IS NOT NULL').all() as Array<{ slug: string; tvl_components: string }>) {
    for (const c of parseJson<Array<{ id?: string | null }>>(r.tvl_components, [])) if (c.id) owners.set(c.id, r.slug);
  }
  const incidents = selectIncidents(hacks, catalog, owners);
  const known = new Set((db.prepare('SELECT id FROM incidents').all() as { id: string }[]).map((r) => r.id));
  const firstRun = known.size === 0;
  const ins = db.prepare(`INSERT INTO incidents (id, name, date, amount_usd, returned_usd, chains, classification, technique, target_type, bridge_hack,
      description, source_url, relevance, catalog_slug, synced_at) VALUES (@id, @name, @date, @amount_usd, @returned_usd, @chains, @classification,
      @technique, @target_type, @bridge_hack, @description, @source_url, @relevance, @catalog_slug, @synced_at)
      ON CONFLICT(id) DO UPDATE SET amount_usd = excluded.amount_usd, returned_usd = excluded.returned_usd, chains = excluded.chains,
      classification = excluded.classification, technique = excluded.technique, target_type = excluded.target_type, bridge_hack = excluded.bridge_hack,
      description = excluded.description, source_url = excluded.source_url, relevance = excluded.relevance, catalog_slug = excluded.catalog_slug,
      synced_at = excluded.synced_at`);
  db.transaction(() => {
    for (const i of incidents) ins.run({ ...i, chains: JSON.stringify(i.chains), bridge_hack: i.bridge_hack ? 1 : 0, synced_at: now });
    if (!firstRun) {
      recordEvents(db, incidents.filter((i) => !known.has(i.id) && i.relevance === 'near').map((i) => ({
        kind: 'incident_added' as const,
        subject: `incident:${i.id}`,
        title: `Security incident: ${i.name}, ${usd(i.amount_usd)} (${i.date})`,
        detail: { technique: i.technique, chains: i.chains, catalog_slug: i.catalog_slug },
        source_url: i.source_url,
        key: i.id,
      })), now);
    }
  })();
  logRun('incidents', { status: 'success', items: incidents.length }, db);
  console.log(`[sync-incidents] ${incidents.filter((i) => i.relevance === 'near').length} NEAR incidents, ${incidents.filter((i) => i.relevance === 'related').length} related, from ${hacks.length} hacks`);
}

if (isEntrypoint(import.meta.url)) {
  guardSync('incidents', main).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
