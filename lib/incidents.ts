/**
 * Security incidents in the NEAR ecosystem, from DefiLlama's hacks dataset
 * (https://api.llama.fi/hacks), each tied to its NEAR Catalog project where
 * one matches.
 *
 * Relevance is decided here, not by the dataset's chain field alone: the
 * NEAR Intents exploit of 2026-10-01 ($3.8M) is filed under BSC because the
 * bridge leg was hit there. A hack is "near" when its chains include NEAR or
 * Aurora or its name or description says NEAR or Aurora. A hack of a NEAR
 * Catalog project on another chain (Meta Pool's mpETH on Ethereum) is
 * "related", kept apart: the catalog also lists exchanges and multichain
 * apps, and calling a Binance or Banana Gun hack a NEAR incident misleads.
 *
 * The project a hack belongs to is found by DefiLlama protocol id first,
 * through the same protocol-to-project join TVL uses (Rhea Lend is protocol
 * 1546, under Rhea Finance), then by name. A "related" hack needs the exact
 * name: by prefix, the Wormhole "Portal" hack landed on Portal Pad and
 * "Fractal Protocol" on the Fractal identity app.
 *
 * NEAR and Aurora are looked for in the name, not the description: a
 * description says where stolen funds were bridged or laundered as often as
 * where the hack happened.
 *
 * The id is DefiLlama's protocol id with the date when there is one, so a
 * renamed entry stays the same incident; otherwise the name and the date.
 */

export const HACKS_URL = 'https://api.llama.fi/hacks';
export const HACKS_PAGE = 'https://defillama.com/hacks';

export interface RawHack {
  date: number;
  name: string;
  classification?: string | null;
  technique?: string | null;
  amount?: number | null;
  chain?: string[] | null;
  bridgeHack?: boolean | null;
  targetType?: string | null;
  source?: string | null;
  returnedFunds?: number | null;
  defillamaId?: number | string | null;
  description?: string | null;
}

export interface CatalogRef { slug: string; name: string; tags: string[] }

export type Relevance = 'near' | 'related';

export interface Incident {
  id: string;
  name: string;
  date: string;
  amount_usd: number | null;
  returned_usd: number | null;
  chains: string[];
  classification: string | null;
  technique: string | null;
  target_type: string | null;
  bridge_hack: boolean;
  description: string | null;
  source_url: string;
  relevance: Relevance;
  catalog_slug: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Catalog entries that are exchanges: their hacks happen to custodial wallets, not to anything built on NEAR. */
const NOT_NEAR_BUILT = new Set(['cex']);

/** DefiLlama protocol id -> catalog slug, from the TVL join. */
export type ProtocolOwners = ReadonlyMap<string, string>;

export function relevanceOf(h: RawHack, catalog: readonly CatalogRef[], owners: ProtocolOwners = new Map()): { relevance: Relevance; catalog_slug: string | null } | null {
  const name = norm(h.name);
  // By name and by slug: a project renamed keeps its slug ("Ref Finance" is
  // "Rhea Finance" under ref-finance), and a hack is filed under the name of
  // its day.
  const names = (c: CatalogRef) => [norm(c.name), norm(c.slug)].filter((n) => n.length >= 4);
  const byId = h.defillamaId === undefined || h.defillamaId === null ? undefined : owners.get(String(h.defillamaId));
  const exact = byId ? catalog.find((c) => c.slug === byId) : catalog.find((c) => names(c).includes(name));
  const chains = (h.chain ?? []).map((c) => c.toLowerCase());
  if (chains.includes('near') || chains.includes('aurora') || /\bNEAR\b|Near Protocol|\bAurora\b/.test(h.name)) {
    const project = exact ?? catalog.find((c) => names(c).some((n) => name.startsWith(`${n} `)));
    return { relevance: 'near', catalog_slug: project?.slug ?? null };
  }
  if (exact && !exact.tags.some((t) => NOT_NEAR_BUILT.has(t))) return { relevance: 'related', catalog_slug: exact.slug };
  return null;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function incidentId(h: RawHack, date: string): string {
  const llama = h.defillamaId === undefined || h.defillamaId === null ? '' : String(h.defillamaId).replace(/[^0-9a-z-]/gi, '');
  if (llama) return `llama-${llama}-${date}`;
  const s = slug(h.name);
  return s ? `${s}-${date}` : `hack-${date}-${h.date}`;
}

const HTTP_URL = /^https?:\/\/[^\s<>"]+$/;

export function toIncident(h: RawHack, rel: { relevance: Relevance; catalog_slug: string | null }): Incident {
  const date = new Date(h.date * 1000).toISOString().slice(0, 10);
  const source = h.source?.trim() ?? '';
  return {
    id: incidentId(h, date),
    name: h.name,
    date,
    amount_usd: typeof h.amount === 'number' ? h.amount : null,
    returned_usd: typeof h.returnedFunds === 'number' ? h.returnedFunds : null,
    chains: h.chain ?? [],
    classification: h.classification?.trim() || null,
    technique: h.technique?.trim() || null,
    target_type: h.targetType?.trim() || null,
    bridge_hack: Boolean(h.bridgeHack),
    description: h.description?.trim() || null,
    source_url: HTTP_URL.test(source) ? source : HACKS_PAGE,
    ...rel,
  };
}

export function selectIncidents(hacks: readonly RawHack[], catalog: readonly CatalogRef[], owners: ProtocolOwners = new Map()): Incident[] {
  const out: Incident[] = [];
  for (const h of hacks) {
    if (!h?.name || typeof h.date !== 'number' || !Number.isFinite(h.date) || Math.abs(h.date) > 1e11) continue;
    const rel = relevanceOf(h, catalog, owners);
    if (rel) out.push(toIncident(h, rel));
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export function usd(n: number | null): string {
  if (n === null) return 'amount unknown';
  return n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${n}`;
}
