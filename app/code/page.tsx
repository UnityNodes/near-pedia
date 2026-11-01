import Link from 'next/link';
import { getCodeItems } from '@/lib/code';
import { CodeItemRow, REPO_LABEL } from '@/components/code-item-row';
import { Chip, ChipRow, ListPager, ListSearch } from '@/components/list-tools';
import { PageShell, PgFoot, PgList } from '@/components/page-shell';
import { getLastSync } from '@/lib/section-counts';
import { pageMetadata } from '@/lib/seo';
import { breadcrumbList, collectionPage } from '@/lib/jsonld';
import { JsonLd } from '@/components/json-ld';
import './design.css';

export const revalidate = 300;

const PER_PAGE = 30;
const REPO_CHIPS = 12;
const STAGGER_MS = 30;
const STAGGER_ROWS = 14;

export const metadata = pageMetadata({
  title: 'Code Browser',
  description: 'Browse GitHub issues and pull requests across yourchain-node, yourchain-app, yourchain-core, CIPs and other ecosystem repositories.',
  path: '/code',
});

interface PageProps {
  searchParams: Promise<{ repo?: string; state?: string; type?: string; q?: string; page?: string }>;
}

export default async function CodePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);
  const repo = params.repo ?? '';
  const state = params.state ?? '';
  const type = params.type ?? '';

  const { items, total, totalPages, repoCounts } = getCodeItems({
    repo: repo || undefined,
    state: state || undefined,
    type: type || undefined,
    q: params.q,
    page,
    perPage: PER_PAGE,
  });

  const buildUrl = (overrides: { p?: number; r?: string; s?: string; t?: string } = {}) => {
    const sp = new URLSearchParams();
    const r = overrides.r !== undefined ? overrides.r : repo;
    const s = overrides.s !== undefined ? overrides.s : state;
    const t = overrides.t !== undefined ? overrides.t : type;
    const p = overrides.p ?? 1;
    if (r) sp.set('repo', r);
    if (s) sp.set('state', s);
    if (t) sp.set('type', t);
    if (params.q) sp.set('q', params.q);
    if (p > 1) sp.set('page', String(p));
    const qs = sp.toString();
    return `/code${qs ? '?' + qs : ''}`;
  };

  const totalRepos = repoCounts.reduce((s, r) => s + r.count, 0);
  const hasFilters = Boolean(repo || state || type || params.q);

  const schemas = [
    collectionPage({
      name: 'YourChain Code Browser',
      description: 'GitHub issues and pull requests across yourchain-node, yourchain-app, yourchain-core, CIPs and other YourChain ecosystem repositories.',
      path: '/code',
      itemCount: totalRepos,
    }),
    breadcrumbList([
      { name: 'Home', path: '/' },
      { name: 'Code', path: '/code' },
    ]),
  ];

  return (
    <PageShell
      href="/code"
      title="Code"
      kicker="COMMUNITY · CODE BROWSER"
      description="GitHub issues and pull requests across yourchain-node, yourchain-app, yourchain-core, CIPs and other ecosystem repos."
      stat={{ value: totalRepos, unit: 'issues and PRs' }}
      synced={getLastSync('github_items')}
      source="GitHub"
    >
      <JsonLd payload={schemas} />

      <div className="pg-tools">
        <div className="pg-tools-row">
          <ListSearch
            action="/code"
            query={params.q}
            label="Search issues and pull requests"
            placeholder="Search issues and pull requests…"
            carry={{ repo, state, type }}
          />
          <ChipRow ariaLabel="Filter by state" label="State" nav>
            <Chip href={buildUrl({ s: '' })} on={!state}>Any</Chip>
            <Chip href={buildUrl({ s: 'open' })} on={state === 'open'}>Open</Chip>
            <Chip href={buildUrl({ s: 'closed' })} on={state === 'closed'}>Closed</Chip>
          </ChipRow>
          <ChipRow ariaLabel="Filter by type" label="Type" nav>
            <Chip href={buildUrl({ t: '' })} on={!type}>Any</Chip>
            <Chip href={buildUrl({ t: 'issue' })} on={type === 'issue'}>Issue</Chip>
            <Chip href={buildUrl({ t: 'pr' })} on={type === 'pr'}>PR</Chip>
          </ChipRow>
        </div>
        <ChipRow ariaLabel="Filter by repository">
          <Chip href={buildUrl({ r: '' })} on={!repo} count={totalRepos}>All</Chip>
          {repoCounts.slice(0, REPO_CHIPS).map(r => (
            <Chip key={r.repo} href={buildUrl({ r: r.repo })} on={repo === r.repo} count={r.count}>
              {REPO_LABEL[r.repo] ?? r.repo.split('/')[1]}
            </Chip>
          ))}
        </ChipRow>
      </div>

      <PgList
        empty={items.length === 0 ? (
          <div className="pg-empty">
            No items match these filters.{' '}
            <Link href="/code">Clear filters →</Link>
          </div>
        ) : null}
      >
        {items.map((it, i) => (
          <CodeItemRow key={it.id} item={it} delay={Math.min(i, STAGGER_ROWS) * STAGGER_MS} />
        ))}
      </PgList>

      <ListPager page={page} totalPages={totalPages} hrefFor={(p) => buildUrl({ p })} />

      <PgFoot shown={items.length} total={total}>
        {hasFilters ? <Link href="/code">Clear filters →</Link> : undefined}
      </PgFoot>
    </PageShell>
  );
}
