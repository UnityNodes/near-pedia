import Link from 'next/link';
import { permanentRedirect } from 'next/navigation';
import { pageMetadata } from '@/lib/seo';
import { formatDateLong } from '@/lib/utils';
import { RELEASE_PRODUCTS, currentReleases, getReleases, isReleaseProduct } from '@/lib/releases';
import type { ReleaseItem, VersionLink } from '@/lib/releases';
import { getLastSync } from '@/lib/section-counts';
import { EmptyAnimation } from '@/components/resources-empty-animation';
import { PageShell, PgFoot, PgList, PgRow } from '@/components/page-shell';
import type { Tone } from '@/components/page-shell';
import { PgPager } from '@/components/pg-pager';
import './design.css';

export const revalidate = 300;

export const metadata = pageMetadata({
  title: 'Releases',
  description: 'The current version of each NEAR product and what changed in every release, with its notes.',
  path: '/releases',
});

const PER_PAGE = 30;
const LEGACY_PRODUCT = 'release-notes';
const MAX_STAGGER = 12;

interface PageProps {
  searchParams: Promise<{ product?: string; page?: string }>;
}

function VersionValue({ link }: { link: VersionLink }) {
  return link.id
    ? <Link href={`/releases/${link.id}`} className="rl-version">{link.version}</Link>
    : <span className="rl-version">{link.version}</span>;
}

function VersionNote({ link }: { link: VersionLink }) {
  const version = link.id ? <Link href={`/releases/${link.id}`}>{link.version}</Link> : <span>{link.version}</span>;
  return <>{version}{link.date ? `, ${formatDateLong(link.date)}` : ''}</>;
}

function toneOf(item: ReleaseItem): Tone {
  if (item.prerelease) return 'info';
  return item.latestInLine ? 'lime' : 'mute';
}

function metaOf(item: ReleaseItem): string {
  return [
    item.repo,
    item.line ? `${item.line} line` : null,
    item.latestInLine ? `latest in ${item.line}` : null,
    item.prerelease ? 'pre-release' : null,
  ].filter(Boolean).join(' · ');
}

export default async function ReleasesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  if (params.product === LEGACY_PRODUCT) permanentRedirect('/releases');
  const product = isReleaseProduct(params.product) ? params.product : undefined;
  const { items, total, page, totalPages, counts } = getReleases({ product, page: parseInt(params.page ?? '1', 10), perPage: PER_PAGE });
  const current = currentReleases().filter(c => c.latest);
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const productLabel = RELEASE_PRODUCTS.find(p => p.key === product)?.label;

  const buildUrl = (next: { product?: string | null; page?: number }) => {
    const sp = new URLSearchParams();
    const prod = next.product === undefined ? product : next.product;
    if (prod) sp.set('product', prod);
    if (next.page && next.page > 1) sp.set('page', String(next.page));
    const qs = sp.toString();
    return `/releases${qs ? `?${qs}` : ''}`;
  };

  return (
    <PageShell
      href="/releases"
      title="Releases"
      description="The current version of each NEAR product, and what changed in every release, with the notes its maintainers published for it."
      stat={{ value: all, unit: all === 1 ? 'release' : 'releases' }}
      synced={getLastSync('github_releases')}
      source="github_releases"
    >
      {current.length > 0 ? (
        <section className="rl-now" aria-labelledby="rl-now-title">
          <h2 id="rl-now-title">Current versions</h2>
          <dl className="pg-cards rl-grid">
            {current.map((c, i) => (
              <div key={c.product.key} className="pg-card rl-card" style={{ animationDelay: `${i * 40}ms` }}>
                <dt>{c.product.label}</dt>
                <dd>
                  <VersionValue link={c.latest!} />
                  <span className="rl-date">{formatDateLong(c.latest!.date)}</span>
                  {c.lines.map(l => <span key={l.label} className="rl-note">Latest {l.label}: <VersionNote link={l} /></span>)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="rl-caption">Newest stable release of each product, from its GitHub releases.</p>
        </section>
      ) : null}

      <div className="pg-tools">
        <nav className="pg-chips" aria-label="Product">
          <Link href={buildUrl({ product: null, page: 1 })} className={`pg-chip${!product ? ' pg-chip--on' : ''}`} aria-current={!product ? 'true' : undefined}>
            All<span className="pg-chip-n">{all.toLocaleString('en-US')}</span>
          </Link>
          {RELEASE_PRODUCTS.map(p => (
            <Link key={p.key} href={buildUrl({ product: p.key, page: 1 })} className={`pg-chip${product === p.key ? ' pg-chip--on' : ''}`} aria-current={product === p.key ? 'true' : undefined}>
              {p.label}<span className="pg-chip-n">{(counts[p.key] ?? 0).toLocaleString('en-US')}</span>
            </Link>
          ))}
        </nav>
        <div className="pg-listhead">
          <h2 id="rl-list-title">{productLabel ? `${productLabel} releases, newest first` : 'All releases, newest first'}</h2>
          <span><b>{total.toLocaleString('en-US')}</b> {total === 1 ? 'release' : 'releases'}</span>
        </div>
      </div>

      <PgList
        empty={items.length === 0 ? (
          <div className="pg-empty">
            <EmptyAnimation />
            <p>No releases held{productLabel ? ` for ${productLabel}` : ''} yet. The GitHub releases sync fills this page.</p>
          </div>
        ) : null}
      >
        {items.map((item, i) => (
          <PgRow
            key={item.id}
            href={`/releases/${item.id}`}
            tag={item.version}
            tone={toneOf(item)}
            meta={metaOf(item)}
            title={item.title}
            sub={item.summary || undefined}
            date={item.date ? formatDateLong(item.date) : 'Undated'}
            delay={Math.min(i, MAX_STAGGER) * 40}
          />
        ))}
      </PgList>
      <PgPager page={page} totalPages={totalPages} hrefFor={n => buildUrl({ page: n })} />
      <PgFoot shown={items.length} total={total} />
    </PageShell>
  );
}
