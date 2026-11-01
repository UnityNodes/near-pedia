import Link from 'next/link';
import Image from 'next/image';
import { getEcosystemProjects } from '@/lib/ecosystem';
import { Chip, ChipRow, ExtLink, ListPager, ListSearch } from '@/components/list-tools';
import { PageShell, PgFoot } from '@/components/page-shell';
import { EmptyAnimation } from '@/components/resources-empty-animation';
import { getLastSync } from '@/lib/section-counts';
import { pageMetadata } from '@/lib/seo';
import { breadcrumbList, collectionPage } from '@/lib/jsonld';
import { JsonLd } from '@/components/json-ld';
import './design.css';

export const revalidate = 600;

const PER_PAGE = 60;
const STAGGER_MS = 30;
const STAGGER_CARDS = 12;
const MAX_TAGS = 4;
const MAX_DESCRIPTION = 200;

export const metadata = pageMetadata({
  title: 'Ecosystem Projects',
  description: 'YourChain ecosystem catalog: wallets, infrastructure, tooling and other projects building on YourChain. Sourced from yourchain.example/ecosystem.',
  path: '/ecosystem',
});

interface PageProps {
  searchParams: Promise<{ category?: string; q?: string; page?: string }>;
}

function cleanTitle(title: string): string {
  return title.replace(/\s*[-—|]\s*YourChain.*$/i, '').replace(/\s*\d{4}$/, '').trim();
}

export default async function EcosystemPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);
  const category = params.category ?? '';

  const { projects, total, totalPages, categories } = getEcosystemProjects({
    category: category || undefined,
    q: params.q,
    page,
    perPage: PER_PAGE,
  });

  const buildUrl = (overrides: { p?: number; c?: string } = {}) => {
    const sp = new URLSearchParams();
    const c = overrides.c !== undefined ? overrides.c : category;
    const p = overrides.p ?? 1;
    if (c) sp.set('category', c);
    if (params.q) sp.set('q', params.q);
    if (p > 1) sp.set('page', String(p));
    const qs = sp.toString();
    return `/ecosystem${qs ? '?' + qs : ''}`;
  };

  const grandTotal = categories.reduce((s, c) => s + c.count, 0);
  const hasFilters = Boolean(category || params.q);

  const schemas = [
    collectionPage({
      name: 'YourChain Ecosystem Projects',
      description: 'Catalog of projects building on YourChain across categories like DeFi, wallets, infrastructure and tokenized assets.',
      path: '/ecosystem',
      itemCount: total,
    }),
    breadcrumbList([
      { name: 'Home', path: '/' },
      { name: 'Ecosystem', path: '/ecosystem' },
    ]),
  ];

  return (
    <PageShell
      href="/ecosystem"
      title="Ecosystem"
      description={
        <>
          Catalog of projects building on YourChain, sourced from{' '}
          <ExtLink href="https://yourchain.example/ecosystem">yourchain.example/ecosystem ↗</ExtLink>
          . Each card links back to the upstream project listing.
        </>
      }
      stat={{ value: grandTotal, unit: grandTotal === 1 ? 'project' : 'projects' }}
      synced={getLastSync('ecosystem_projects')}
      source="yourchain.example/ecosystem"
    >
      <JsonLd payload={schemas} />

      <div className="pg-tools">
        <div className="pg-tools-row">
          <ListSearch
            action="/ecosystem"
            query={params.q}
            label="Search ecosystem projects"
            placeholder="Search ecosystem projects…"
            carry={{ category }}
          />
        </div>
        <ChipRow ariaLabel="Filter by category">
          <Chip href={buildUrl({ c: '' })} on={!category} count={grandTotal}>All</Chip>
          {categories.map(c => (
            <Chip key={c.category} href={buildUrl({ c: c.category })} on={category === c.category} count={c.count}>
              {c.category}
            </Chip>
          ))}
        </ChipRow>
      </div>

      {projects.length === 0 ? (
        <div className="pg-list">
          <div className="pg-empty">
            {hasFilters ? (
              <>
                No projects match these filters.{' '}
                <Link href="/ecosystem">Clear filters →</Link>
              </>
            ) : (
              <>
                <EmptyAnimation />
                <p>No projects held yet. The ecosystem sync fills this page.</p>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="pg-cards">
          {projects.map((p, i) => {
            const tags = p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, MAX_TAGS) : [];
            return (
              <a
                key={p.slug}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="pg-card eco-card"
                style={{ animationDelay: `${Math.min(i, STAGGER_CARDS) * STAGGER_MS}ms` }}
              >
                <div>
                  <span className="pg-tag" data-tone="lime">{p.category ?? 'Other'}</span>
                </div>
                <div className="eco-name">
                  {p.logo && (
                    <span className="eco-logo">
                      <Image src={p.logo} alt="" fill sizes="36px" />
                    </span>
                  )}
                  <b>{cleanTitle(p.title)}</b>
                </div>
                {p.description && (
                  <p className="eco-desc">{p.description.replace(/&hellip;|…\s*$/, '').slice(0, MAX_DESCRIPTION)}…</p>
                )}
                {tags.length > 0 && (
                  <div className="eco-tags">
                    {tags.map(t => <span key={t} className="eco-tag">{t}</span>)}
                  </div>
                )}
                <span className="pg-card-foot">
                  View project ↗
                  <span className="pg-sr"> (opens in a new tab)</span>
                </span>
              </a>
            );
          })}
        </div>
      )}

      <ListPager page={page} totalPages={totalPages} hrefFor={(p) => buildUrl({ p })} />

      <PgFoot shown={projects.length} total={total}>
        {hasFilters ? <Link href="/ecosystem">Clear filters →</Link> : undefined}
      </PgFoot>
    </PageShell>
  );
}
