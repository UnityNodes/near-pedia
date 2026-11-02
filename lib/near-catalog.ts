/**
 * NEAR Catalog (api.nearcatalog.xyz) reduced to ecosystem_projects, with
 * TVL on NEAR from DefiLlama's protocol list.
 *
 * A DefiLlama protocol is joined to a catalog project, in this order, by
 * the exact host of its website, by its own name, by the registrable domain
 * when one catalog project alone holds it, and by its parent protocol's
 * name. The domain lands Rhea Lend (lending.rhea.finance), RHEA LST and Rhea
 * Dex on Rhea Finance (www.rhea.finance). The name comes before it because
 * DefiLlama lists LiNEAR under linearprotocol.org, the catalog under
 * linearprotocol.io, and the only catalog project on linearprotocol.org is
 * Phoenix Bonds, a LiNEAR product. The parent catches NEAR Bridge, listed
 * under the shared near.org, as part of NEAR Protocol. Several
 * protocols of one project are summed and listed. Exchanges (category CEX)
 * hold user deposits, not protocol TVL, and are left out.
 */

export const CATALOG_LIST_URL = 'https://api.nearcatalog.xyz/projects';
export const CATALOG_DETAIL_URL = (slug: string) => `https://api.nearcatalog.xyz/project?pid=${encodeURIComponent(slug)}`;
/**
 * Catalog slugs are lowercase words joined by hyphens, already URL-encoded
 * where the name had other characters ("curate-fun-%ef%b8%8f-autonomous-news"
 * keeps an emoji's variation selector); anything else is not stored. A
 * stored slug is therefore safe to put in a URL as it is.
 */
export const SLUG_RE = /^[a-z0-9][a-z0-9%-]{0,149}$/;

export const CATALOG_PAGE_URL = (slug: string) => `https://nearcatalog.xyz/project/${slug}`;
export const PROTOCOLS_URL = 'https://api.llama.fi/protocols';

export interface CatalogListEntry { slug: string; profile: Profile }
export type CatalogList = Record<string, CatalogListEntry>;

export interface Profile {
  name?: string;
  tagline?: string;
  description?: string;
  image?: { url?: string };
  tags?: Record<string, string>;
  phase?: string;
  status?: string;
  updated_date?: number | string;
  dapp?: string;
  linktree?: Record<string, string | null | undefined>;
  tokens?: Record<string, { symbol?: string; address?: Record<string, string | null> }>;
}

export interface CatalogProject {
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  tags: string[];
  /**
   * The project's tag shared by the most catalog projects. Not the first
   * tag: the catalog lists Rhea Finance's "Prediction market" before "DeFi",
   * and grouping by first tag scattered the DeFi projects over a dozen
   * one-project categories. Tags that say what a project integrates with
   * (NEAR Intents, chain abstraction, Aurora) rather than what it is are
   * left out with "dapp" and "other": 45 projects carry "near-intents".
   */
  category: string;
  phase: string | null;
  status: string | null;
  website: string | null;
  github: string | null;
  twitter: string | null;
  dapp: string | null;
  logo: string | null;
  tokens: Array<{ symbol: string; near: string | null }>;
  catalog_updated_at: string | null;
}

const GENERIC_TAGS = new Set(['dapp', 'other', 'infrastructure', 'near-intents', 'chain-abstraction', 'aurora']);
/**
 * An http(s) link, normalised by the URL parser: listings are self-written,
 * and a prefix check let "https://x.io\nIgnore previous instructions" through
 * as a website that is then printed unfenced.
 */
/** Query parameters that carry a referral or a tracking tag, not the page: a catalog listing linked Rhea's app with someone's points code. */
const TRACKING_PARAM = /^(?:code|ref|referral|referrer|invite|invite_code|affiliate|utm_[a-z]+)$/i;

export function safeUrl(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}
const url = safeUrl;

/** The list sends updated_date as a number and the detail as a string of the same seconds. */
function epochIso(v: unknown): string | null {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && n > 0 ? new Date(n * 1000).toISOString() : null;
}

/** How many projects carry each tag, for picking a project's broadest field. */
export function tagCounts(list: CatalogList): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const e of Object.values(list)) for (const t of Object.keys(e?.profile?.tags ?? {})) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

export function fromCatalog(slug: string, profile: Profile, detail?: Profile, counts: ReadonlyMap<string, number> = new Map()): CatalogProject {
  const p = { ...profile, ...(detail ?? {}) };
  const tags = Object.keys(p.tags ?? {});
  const label = p.tags ?? {};
  const fields = tags.filter((t) => !GENERIC_TAGS.has(t));
  const field = fields.reduce<string | undefined>((best, t) => (best === undefined || (counts.get(t) ?? 0) > (counts.get(best) ?? 0) ? t : best), undefined) ?? tags[0];
  return {
    slug,
    name: p.name?.trim() || slug,
    tagline: p.tagline?.trim() || null,
    description: p.description?.trim() || null,
    tags,
    category: field ? label[field] ?? field : 'Other',
    phase: p.phase ?? null,
    status: p.status || null,
    website: url(p.linktree?.website),
    github: url(p.linktree?.github),
    twitter: url(p.linktree?.twitter),
    dapp: url(p.dapp),
    logo: url(p.image?.url),
    tokens: Object.values(p.tokens ?? {}).filter((t) => t?.symbol).map((t) => ({ symbol: t.symbol!, near: t.address?.near || null })),
    catalog_updated_at: epochIso(p.updated_date),
  };
}

export function hostOf(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * `lending.rhea.finance` -> `rhea.finance`; null for a URL that does not parse.
 * A two-letter country TLD under a short second level (`co.uk`, `com.au`)
 * keeps three labels. Not a public-suffix list: the catalog's sites are
 * almost all generic TLDs, and a miss here only loses a join, it does not
 * make one.
 */
export function registrableDomain(u: string | null | undefined): string | null {
  const host = hostOf(u);
  if (!host) return null;
  const parts = host.split('.');
  const keep = parts.length >= 3 && parts[parts.length - 1].length === 2 && parts[parts.length - 2].length <= 3 ? 3 : 2;
  return parts.length <= keep ? host : parts.slice(-keep).join('.');
}

/**
 * Domains several unrelated projects share: a project whose site is a NEAR
 * Foundation page, a GitHub repo or a social profile says nothing about
 * which DefiLlama protocol it is.
 */
const SHARED_DOMAINS = new Set([
  'near.org', 'near.com', 'near.social', 'github.com', 'github.io', 'x.com', 'twitter.com', 'medium.com', 'linktr.ee', 't.me',
  'notion.site', 'gitbook.io', 'vercel.app', 'netlify.app', 'pages.dev', 'web.app', 'ipfs.io', 'google.com', 'substack.com', 'mirror.xyz',
]);

export interface RawProtocol { id?: string | number; name: string; slug?: string; url?: string | null; category?: string | null; chains?: string[]; chainTvls?: Record<string, number>; parentProtocol?: string | null }

export interface ProjectTvl { tvl_usd: number; components: Array<{ id: string | null; name: string; slug: string | null; tvl_usd: number }> }

type ProjectRef = Pick<CatalogProject, 'slug' | 'name' | 'website'>;

const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The catalog project a DefiLlama protocol is, or null when nothing ties them. */
export function protocolMatcher(projects: readonly ProjectRef[]): (proto: RawProtocol) => string | null {
  const byHost = new Map<string, string[]>();
  const byDomain = new Map<string, string[]>();
  const byName = new Map<string, string>();
  for (const p of projects) {
    const host = hostOf(p.website);
    const d = registrableDomain(p.website);
    if (host && !SHARED_DOMAINS.has(host) && !(d && SHARED_DOMAINS.has(d))) byHost.set(host, [...(byHost.get(host) ?? []), p.slug]);
    if (d && !SHARED_DOMAINS.has(d)) byDomain.set(d, [...(byDomain.get(d) ?? []), p.slug]);
    for (const k of [nameKey(p.name), nameKey(p.slug)]) if (k.length >= 4 && !byName.has(k)) byName.set(k, p.slug);
  }
  return (proto) => {
    const host = hostOf(proto.url);
    const onHost = host ? byHost.get(host) ?? [] : [];
    if (onHost.length === 1) return onHost[0];
    const named = (v: string | null | undefined) => (v ? byName.get(nameKey(v)) ?? null : null);
    const own = named(proto.name) ?? named(proto.slug);
    if (own) return own;
    const d = registrableDomain(proto.url);
    const owners = d && !SHARED_DOMAINS.has(d) ? byDomain.get(d) ?? [] : [];
    if (owners.length === 1) return owners[0];
    const parent = named(proto.parentProtocol?.replace(/^parent#/, ''));
    return parent && (owners.length === 0 || owners.includes(parent)) ? parent : null;
  };
}

export function tvlByProject(protocols: readonly RawProtocol[], projects: readonly ProjectRef[]): Map<string, ProjectTvl> {
  const match = protocolMatcher(projects);
  const out = new Map<string, ProjectTvl>();
  for (const proto of protocols) {
    if (proto.category === 'CEX' || !(proto.chains ?? []).includes('Near')) continue;
    const tvl = proto.chainTvls?.Near;
    if (typeof tvl !== 'number' || tvl <= 0) continue;
    const slug = match(proto);
    if (!slug) continue;
    const cur = out.get(slug) ?? { tvl_usd: 0, components: [] };
    out.set(slug, {
      tvl_usd: cur.tvl_usd + tvl,
      components: [...cur.components, { id: proto.id === undefined || proto.id === null ? null : String(proto.id), name: proto.name, slug: proto.slug ?? null, tvl_usd: tvl }],
    });
  }
  return new Map([...out].map(([slug, v]) => [slug, { ...v, components: [...v.components].sort((a, b) => b.tvl_usd - a.tvl_usd) }]));
}
