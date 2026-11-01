import type Database from 'better-sqlite3';
import { marked } from 'marked';
import { getDb } from './db';
import { isStableRelease, latestStableByLine } from './yourchain-versions';
import type { ReleaseRow } from './yourchain-versions';
import { RELEASE_PRODUCT_SPECS, RELEASE_REPOS, versionFromTag } from './release-sources';
import { notesHtml, releaseSummary } from './release-text';
import { compareVersions, releaseLine } from './release-version';

export interface ReleaseProduct {
  key: string;
  label: string;
  repo: string;
}

export const RELEASE_PRODUCTS: readonly ReleaseProduct[] = RELEASE_PRODUCT_SPECS.map(({ key, label, repo }) => ({ key, label, repo }));

export interface ReleaseItem {
  id: string;
  product: string;
  name: string;
  version: string;
  title: string;
  date: string | null;
  summary: string;
  line: string | null;
  sourceUrl: string;
  sourceLabel: string;
  prerelease: boolean;
  latestInLine: boolean;
  repo: string;
  tag: string;
  aliases: string[];
}

interface GithubRow extends ReleaseRow {
  id: string;
  body: string | null;
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

function rowsOf(db: Database.Database): GithubRow[] {
  return db.prepare(`SELECT id, repo, tag, name, body, published_at, url, prerelease FROM github_releases WHERE repo IN (${placeholders(RELEASE_REPOS.length)}) ORDER BY published_at DESC`)
    .all(...RELEASE_REPOS) as GithubRow[];
}

interface ProductRow {
  row: GithubRow;
  product: ReleaseProduct;
  version: string;
}

/**
 * Each release row under the product its tag belongs to. A tag of another
 * package in the same repository (near-sys-v0.4.0 in near-sdk-rs) matches no
 * product and is left out.
 */
function productRowsOf(rows: GithubRow[]): ProductRow[] {
  const out: ProductRow[] = [];
  for (const row of rows) {
    for (const spec of RELEASE_PRODUCT_SPECS) {
      if (spec.repo !== row.repo) continue;
      const version = versionFromTag(spec, row.tag);
      if (version === null) continue;
      out.push({ row, product: RELEASE_PRODUCTS.find(p => p.key === spec.key)!, version });
      break;
    }
  }
  return out;
}

/** The row with its tag reduced to the bare version, for the stable-line helpers that read `tag`. */
function asVersionRow({ row, version }: ProductRow): GithubRow {
  return { ...row, tag: version };
}

function itemOf({ row: r, product, version }: ProductRow): ReleaseItem {
  return {
    id: `${product.key}-${version}`,
    product: product.key,
    name: product.label,
    version,
    title: `${product.label} ${version}`,
    date: r.published_at,
    summary: releaseSummary(r.body),
    line: releaseLine(version),
    sourceUrl: r.url,
    sourceLabel: 'Open on GitHub',
    prerelease: !isStableRelease({ tag: version, prerelease: r.prerelease }),
    latestInLine: false,
    repo: r.repo,
    tag: r.tag,
    aliases: [`rel-${r.id}`],
  };
}

function markLatestInLine(items: ReleaseItem[]): ReleaseItem[] {
  const best = new Map<string, ReleaseItem>();
  for (const i of items) {
    if (i.prerelease || !i.line) continue;
    const key = `${i.product}|${i.line}`;
    const current = best.get(key);
    if (!current || compareVersions(i.version, current.version) > 0) best.set(key, i);
  }
  const latest = new Set(best.values());
  return items.map(i => (latest.has(i) ? { ...i, latestInLine: true } : i));
}

function newestFirst(a: ReleaseItem, b: ReleaseItem): number {
  return (b.date ?? '').localeCompare(a.date ?? '') || compareVersions(b.version, a.version) || a.id.localeCompare(b.id);
}

function stampOf(db: Database.Database): string {
  const row = db.prepare(`SELECT COUNT(*) n, MAX(synced_at) s FROM github_releases WHERE repo IN (${placeholders(RELEASE_REPOS.length)})`)
    .get(...RELEASE_REPOS) as { n: number; s: string | null };
  return `${row.n}|${row.s}`;
}

interface Feed {
  stamp: string;
  items: ReleaseItem[];
  byId: Map<string, ReleaseItem>;
}

let cache: { db: Database.Database; feed: Feed } | null = null;

function feedOf(db: Database.Database): Feed {
  const stamp = stampOf(db);
  if (cache && cache.db === db && cache.feed.stamp === stamp) return cache.feed;
  const items = markLatestInLine(productRowsOf(rowsOf(db)).map(itemOf)).sort(newestFirst);
  const byId = new Map<string, ReleaseItem>();
  for (const item of items) {
    if (!byId.has(item.id)) byId.set(item.id, item);
    for (const alias of item.aliases) byId.set(alias, item);
  }
  const feed = { stamp, items, byId };
  cache = { db, feed };
  return feed;
}

export function releaseFeed(db: Database.Database = getDb()): ReleaseItem[] {
  return feedOf(db).items;
}

export function findRelease(id: string, db: Database.Database = getDb()): ReleaseItem | null {
  return feedOf(db).byId.get(id) ?? null;
}

export function isReleaseProduct(value: string | undefined): boolean {
  return RELEASE_PRODUCTS.some(p => p.key === value);
}

export interface ReleasePage {
  items: ReleaseItem[];
  total: number;
  page: number;
  totalPages: number;
  counts: Record<string, number>;
}

export function getReleases(opts: { product?: string; page?: number; perPage?: number } = {}, db: Database.Database = getDb()): ReleasePage {
  const all = feedOf(db).items;
  const product = RELEASE_PRODUCTS.find(p => p.key === opts.product)?.key;
  const filtered = product ? all.filter(i => i.product === product) : all;
  const perPage = opts.perPage ?? 30;
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const page = Math.min(Math.max(1, Math.floor(opts.page ?? 1) || 1), totalPages);
  const counts = Object.fromEntries(RELEASE_PRODUCTS.map(p => [p.key, all.filter(i => i.product === p.key).length]));
  return { items: filtered.slice((page - 1) * perPage, page * perPage), total: filtered.length, page, totalPages, counts };
}

export interface ReleaseDetail {
  item: ReleaseItem;
  html: string;
  inLine: ReleaseItem[];
  latestInLine: ReleaseItem | null;
  latestOfProduct: ReleaseItem | null;
}

export function getRelease(id: string, db: Database.Database = getDb()): ReleaseDetail | null {
  const feed = feedOf(db);
  const item = feed.byId.get(id);
  if (!item) return null;
  const row = db.prepare('SELECT body FROM github_releases WHERE repo = ? AND tag = ?').get(item.repo, item.tag) as { body: string | null } | undefined;
  const byVersion = (a: ReleaseItem, b: ReleaseItem) => compareVersions(b.version, a.version);
  const stable = feed.items.filter(i => i.product === item.product && !i.prerelease);
  const inLine = feed.items.filter(i => i.product === item.product && i.line === item.line).sort(byVersion);
  return {
    item,
    html: row?.body ? notesHtml(String(marked.parse(row.body))) : '',
    inLine,
    latestInLine: stable.filter(i => i.line === item.line).sort(byVersion)[0] ?? null,
    latestOfProduct: [...stable].sort(byVersion)[0] ?? null,
  };
}

export interface VersionLink {
  label: string;
  version: string;
  date: string | null;
  id: string | null;
}

export interface CurrentVersion {
  product: ReleaseProduct;
  latest: VersionLink | null;
  lines: VersionLink[];
}

export function currentReleases(db: Database.Database = getDb()): CurrentVersion[] {
  const feed = feedOf(db);
  const rows = productRowsOf(rowsOf(db));
  return RELEASE_PRODUCTS.map(product => {
    const lines = latestStableByLine(rows.filter(r => r.product.key === product.key).map(asVersionRow)).map(l => ({
      label: `${l.line}.x`,
      version: l.latest.version,
      date: l.latest.releasedAt,
      id: feed.byId.get(`${product.key}-${l.latest.version}`)?.id ?? null,
    }));
    return { product, latest: lines[0] ?? null, lines: lines.slice(1) };
  });
}
