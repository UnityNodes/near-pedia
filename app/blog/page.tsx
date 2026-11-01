import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Search } from 'lucide-react';
import { BLOG_TABS, getBlogGlance, getBlogPosts, getBlogTabCounts, isBlogSource, parseBlogPage } from '@/lib/blog';
import type { BlogKind, BlogSort, BlogSource } from '@/lib/blog';
import { EmptyAnimation } from '@/components/resources-empty-animation';
import { markWords } from '@/components/doc-card';
import { PageShell, PgFoot, PgList, PgRow } from '@/components/page-shell';
import type { Tone } from '@/components/page-shell';
import { PgPager } from '@/components/pg-pager';
import { pageMetadata } from '@/lib/seo';
import { firstValues } from '@/lib/search-params';
import { formatDateLong } from '@/lib/utils';
import { getLastSync } from '@/lib/section-counts';

export const revalidate = 300;

export const metadata = pageMetadata({
  title: 'Blog',
  description: 'Articles, news and press releases from NEAR, with partner press and third-party reprints in tabs of their own.',
  path: '/blog',
});

const PER_PAGE = 30;
const MAX_STAGGER = 12;
const SEARCH_TRY = ['validator', 'governance', 'token', 'upgrade'];

const TONE_BY_KIND: Partial<Record<BlogKind, Tone>> = {
  blog: 'lime',
  news: 'info',
  'press-release': 'info',
};

interface PageProps {
  searchParams: Promise<{ q?: string; source?: string; sort?: string; page?: string }>;
}

type Overrides = { q?: string | null; source?: string | null; sort?: BlogSort | null; page?: number };

function parseSort(raw: string | undefined, hasQuery: boolean): BlogSort {
  if (raw === 'oldest') return 'oldest';
  if (raw === 'newest') return 'newest';
  if (raw === 'relevance' && hasQuery) return 'relevance';
  return hasQuery ? 'relevance' : 'newest';
}

export default async function BlogPage({ searchParams }: PageProps) {
  const params = firstValues(await searchParams);
  const q = params.q?.trim().slice(0, 120) || undefined;
  const hasQuery = Boolean(q);
  if (params.source && !isBlogSource(params.source)) redirect(q ? `/blog?q=${encodeURIComponent(q)}` : '/blog');
  const source: BlogSource | undefined = isBlogSource(params.source) ? params.source : undefined;
  const page = parseBlogPage(params.page);
  const sort = parseSort(params.sort, hasQuery);

  const { posts, total, totalPages } = getBlogPosts({ source, q, sort, page, perPage: PER_PAGE });
  const counts = getBlogTabCounts(q);
  const glance = getBlogGlance();
  const tab = BLOG_TABS.find(t => t.key === source);

  const buildUrl = (o: Overrides = {}) => {
    const sp = new URLSearchParams();
    const nq = o.q !== undefined ? o.q : q;
    if (nq) sp.set('q', nq);
    const src = o.source !== undefined ? o.source : source;
    if (src) sp.set('source', src);
    const s = o.sort !== undefined ? o.sort : sort;
    if (s && s !== parseSort(undefined, Boolean(nq))) sp.set('sort', s);
    const p = o.page ?? 1;
    if (p > 1) sp.set('page', String(p));
    const qs = sp.toString();
    return `/blog${qs ? `?${qs}` : ''}`;
  };

  if (posts.length === 0 && total > 0 && page > totalPages) redirect(buildUrl({ page: totalPages }));

  const sorts: { key: BlogSort; label: string }[] = [
    ...(hasQuery ? [{ key: 'relevance' as const, label: 'Best match' }] : []),
    { key: 'newest', label: 'Newest' },
    { key: 'oldest', label: 'Oldest' },
  ];
  const scopeLabel = tab ? tab.label : 'All';
  const listTitle = hasQuery
    ? (sort === 'relevance' ? 'Best matches' : sort === 'oldest' ? `${scopeLabel} matches, oldest first` : `${scopeLabel} matches, newest first`)
    : `${scopeLabel}, ${sort === 'oldest' ? 'oldest' : 'newest'} first`;
  const chips = [
    ...(q ? [{ key: 'search', label: `“${q}”`, href: buildUrl({ q: null, sort: null }) }] : []),
    ...(tab ? [{ key: 'tab', label: tab.label, href: buildUrl({ source: null }) }] : []),
  ];

  return (
    <PageShell
      href="/blog"
      title="Blog"
      description="Articles, news and press releases that NEAR publishes on its own sites. Partner press and third-party reprints sit in tabs of their own."
      stat={{
        value: glance.shown,
        unit: glance.shown === glance.held ? (glance.shown === 1 ? 'post' : 'posts') : `posts, of ${glance.held.toLocaleString('en-US')} items held`,
      }}
      synced={getLastSync('blog_posts')}
      source="blog_posts"
    >
      {glance.newest ? (
        <section className="pg-feature" aria-labelledby="blog-newest">
          <h2 id="blog-newest">Newest post</h2>
          <Link href={`/blog/${glance.newest.id}`} className="pg-feature-title">{glance.newest.title}</Link>
          <span className="pg-feature-meta">
            <time dateTime={glance.newest.published_at ?? undefined}>{formatDateLong(glance.newest.published_at)}</time>
            {glance.checkedAt ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Last check {formatDateLong(glance.checkedAt)}, {glance.checkedAt.slice(11, 16)} UTC</span>
              </>
            ) : null}
          </span>
        </section>
      ) : null}

      <div className="pg-tools">
        <div className="pg-tools-row">
          <form action="/blog" method="get" role="search" className="pg-filter">
            <Search size={16} strokeWidth={1.75} aria-hidden="true" />
            <label htmlFor="blog-q" className="pg-sr">Search the blog</label>
            <input
              id="blog-q"
              name="q"
              type="search"
              defaultValue={q ?? ''}
              placeholder="Search posts by title or by what they say"
              autoComplete="off"
            />
            {source ? <input type="hidden" name="source" value={source} /> : null}
            <button type="submit" className="pg-filter-go">Search</button>
          </form>
        </div>

        <nav className="pg-chips" aria-label="Kind of post">
          <Link href={buildUrl({ source: null })} className={`pg-chip${!source ? ' pg-chip--on' : ''}`} aria-current={!source ? 'true' : undefined}>
            All<span className="pg-chip-n">{counts.all.toLocaleString('en-US')}</span>
          </Link>
          {BLOG_TABS.filter(t => counts.bySource[t.key] > 0 || source === t.key).map(t => (
            <Link key={t.key} href={buildUrl({ source: t.key })} className={`pg-chip${source === t.key ? ' pg-chip--on' : ''}`} aria-current={source === t.key ? 'true' : undefined}>
              {t.label}<span className="pg-chip-n">{counts.bySource[t.key].toLocaleString('en-US')}</span>
            </Link>
          ))}
        </nav>

        <div className="pg-tools-row">
          <span className="pg-label">Try</span>
          <div className="pg-chips">
            {SEARCH_TRY.map(w => (
              <Link key={w} href={`/blog?q=${encodeURIComponent(w)}`} className={`pg-chip${q === w ? ' pg-chip--on' : ''}`} aria-current={q === w ? 'true' : undefined}>{w}</Link>
            ))}
          </div>
          <span className="pg-label pg-label--gap">Sort</span>
          <nav className="pg-chips" aria-label="Sort">
            {sorts.map(s => (
              <Link key={s.key} href={buildUrl({ sort: s.key })} className={`pg-chip${sort === s.key ? ' pg-chip--on' : ''}`} aria-current={sort === s.key ? 'true' : undefined}>
                {s.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <section className="pg-tools" aria-labelledby="blog-list-title">
        <div className="pg-listhead">
          <h2 id="blog-list-title">{listTitle}</h2>
          <span><b>{total.toLocaleString('en-US')}</b> {total === 1 ? 'post' : 'posts'}</span>
        </div>

        {chips.length > 0 && posts.length > 0 ? (
          <div className="pg-tools-row">
            <span className="pg-label">Showing</span>
            <div className="pg-chips">
              {chips.map(c => (
                <Link key={c.key} href={c.href} className="pg-chip pg-chip--on" aria-label={`Remove ${c.key} ${c.label}`}>
                  {c.label}<span aria-hidden="true" className="pg-chip-x">×</span>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        <PgList
          empty={posts.length === 0 ? (
            <div className="pg-empty">
              <EmptyAnimation />
              <p>No posts match {q ? <>“{q}”</> : 'these filters'}{tab ? <> in {tab.label}</> : null}.</p>
              <div className="pg-chips">
                {chips.filter(c => c.key !== 'search').map(c => (
                  <Link key={c.key} href={c.href} className="pg-chip">
                    Remove {c.key}<span aria-hidden="true" className="pg-chip-x">×</span>
                  </Link>
                ))}
                {q ? <Link href={`/search?q=${encodeURIComponent(q)}`} className="pg-chip">Search the whole site</Link> : null}
              </div>
            </div>
          ) : null}
        >
          {posts.map((post, i) => (
            <PgRow
              key={post.id}
              href={`/blog/${post.id}`}
              tag={post.label}
              tone={TONE_BY_KIND[post.kind] ?? 'mute'}
              meta={[post.author, post.host].filter(Boolean).join(' · ') || undefined}
              title={markWords(post.title, q)}
              sub={post.line ? markWords(post.line, q) : undefined}
              date={post.published_at ? formatDateLong(post.published_at) : 'Undated'}
              delay={Math.min(i, MAX_STAGGER) * 40}
            />
          ))}
        </PgList>
      </section>

      <PgPager page={page} totalPages={totalPages} hrefFor={n => buildUrl({ page: n })} />
      <PgFoot shown={posts.length} total={total} />
    </PageShell>
  );
}
