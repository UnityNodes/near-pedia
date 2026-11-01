import Link from 'next/link';
import { getTopics, getCategories, getTopicsTotalCount } from '@/lib/forum';
import type { SortOption } from '@/lib/forum';
import { TopicRow } from '@/components/topic-row';
import { TopicFilters } from '@/components/topic-filters';
import { ExtLink, ListPager } from '@/components/list-tools';
import { PageShell, PgFoot, PgList } from '@/components/page-shell';
import { getLastSync } from '@/lib/section-counts';
import { pageMetadata } from '@/lib/seo';
import './design.css';

export const revalidate = 300;

const STAGGER_MS = 35;
const STAGGER_ROWS = 14;

export const metadata = pageMetadata({
  title: 'Discussions',
  description: 'Forum topics from forum.yourchain.example with full-text search, categories, and sorting.',
  path: '/discussions',
});

interface PageProps {
  searchParams: Promise<{ q?: string; category?: string; sort?: string; page?: string }>;
}

export default async function DiscussionsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);
  const category = params.category ? parseInt(params.category, 10) : undefined;
  const sort = (params.sort as SortOption | undefined) ?? 'activity';

  const { topics, total, totalPages } = getTopics({ q: params.q, category, sort, page });
  const categories = getCategories();
  const corpusTotal = getTopicsTotalCount();

  const hasFilters = Boolean(params.q || params.category);

  const buildUrl = (overrides: { page?: number; sort?: SortOption; category?: number | null } = {}) => {
    const sp = new URLSearchParams();
    if (params.q) sp.set('q', params.q);
    const cat = overrides.category !== undefined ? overrides.category : category;
    if (cat) sp.set('category', String(cat));
    const sr = overrides.sort !== undefined ? overrides.sort : sort;
    if (sr !== 'activity') sp.set('sort', sr);
    const p = overrides.page !== undefined ? overrides.page : page;
    if (p > 1) sp.set('page', String(p));
    const qs = sp.toString();
    return `/discussions${qs ? '?' + qs : ''}`;
  };

  return (
    <PageShell
      href="/discussions"
      title="Discussions"
      description={
        <>
          Forum threads and answers, mirrored from{' '}
          <ExtLink href="https://forum.yourchain.example">forum.yourchain.example ↗</ExtLink>
          {' '}with full-text search, categories and sorting.
        </>
      }
      stat={{ value: corpusTotal, unit: corpusTotal === 1 ? 'topic' : 'topics' }}
      synced={getLastSync('forum_topics')}
      source="forum.yourchain.example"
    >
      <TopicFilters
        categories={categories}
        currentCategory={category}
        currentSort={sort}
        currentQuery={params.q}
        totalTopics={corpusTotal}
        buildUrl={(o) => buildUrl({ ...o, page: 1 })}
      />

      <PgList
        empty={topics.length === 0 ? (
          <div className="pg-empty">
            No topics match these filters.{' '}
            <Link href="/discussions">Clear filters →</Link>
          </div>
        ) : null}
      >
        {topics.map((t, i) => (
          <TopicRow key={t.id} topic={t} delay={Math.min(i, STAGGER_ROWS) * STAGGER_MS} />
        ))}
      </PgList>

      <ListPager page={page} totalPages={totalPages} hrefFor={(p) => buildUrl({ page: p })} />

      <PgFoot shown={topics.length} total={total}>
        {hasFilters ? <Link href="/discussions">Clear filters →</Link> : undefined}
      </PgFoot>
    </PageShell>
  );
}
