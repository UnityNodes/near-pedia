import './design.css';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { MAX_PAGE, getDocs, getDocSources, getDocsGlance, docSourceLabel } from '@/lib/docs';
import type { DocSort } from '@/lib/docs';
import { DocCard } from '@/components/doc-card';
import { DocSourceFilter } from '@/components/doc-source-filter';
import { DocsLanding } from '@/components/docs-landing';
import { EmptyAnimation } from '@/components/resources-empty-animation';
import { PageShell, PgFoot, PgList } from '@/components/page-shell';
import { pageMetadata } from '@/lib/seo';
import type { Metadata } from 'next';
import { firstValues } from '@/lib/search-params';
import { formatDateLong } from '@/lib/utils';
import {
  DOC_KINDS, DOC_PER_PAGE, DOC_SEARCH_SUGGESTIONS, cleanDocText, docPageNumbers, docPageWindow, docSortsFor, docSourceKind, kindCounts, kindSources, parseDocKind, parseDocSort, snippet,
} from '@/lib/docs-browse';
import type { DocKind } from '@/lib/docs-browse';

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const total = getDocSources().reduce((n, s) => n + s.count, 0);
  return pageMetadata({
    title: 'Documentation',
    description: `Unified full-text search across the NEAR and ecosystem documentation, ${total.toLocaleString('en-US')} pages.`,
    path: '/docs',
  });
}

interface PageProps {
  searchParams: Promise<{ q?: string; source?: string; kind?: string; sort?: string; page?: string }>;
}

type Overrides = { page?: number; source?: string | null; kind?: DocKind | null; sort?: DocSort | null; q?: string | null };

export default async function DocsPage({ searchParams }: PageProps) {
  const params = firstValues(await searchParams);
  const q = params.q?.trim() || undefined;
  const hasQuery = Boolean(q);
  const page = Math.min(Math.max(1, parseInt(params.page ?? '1', 10) || 1), MAX_PAGE);
  const kind = parseDocKind(params.kind);
  const sort = parseDocSort(params.sort, hasQuery);
  const sorts = docSortsFor(hasQuery);
  const source = params.source || undefined;

  const { docs, total, totalPages } = getDocs({ q, source, sources: kindSources(kind), sort, page, perPage: DOC_PER_PAGE });
  const corpusSources = getDocSources();
  const corpusTotal = corpusSources.reduce((n, s) => n + s.count, 0);
  const scopeSources = hasQuery ? getDocSources(q) : corpusSources;
  const kinds = kindCounts(scopeSources);
  const facetSources = kind ? scopeSources.filter(s => docSourceKind(s.source) === kind) : scopeSources;
  const glance = getDocsGlance();

  const landing = !hasQuery && !source && !kind && page === 1;
  const sourceLabel = source ? docSourceLabel(source, corpusSources.find(s => s.source === source)?.url) : '';
  const kindLabel = kind ? DOC_KINDS.find(k => k.key === kind)?.label ?? kind : '';

  const buildUrl = (o: Overrides = {}) => {
    const sp = new URLSearchParams();
    const nq = o.q !== undefined ? o.q : q;
    if (nq) sp.set('q', nq);
    const src = o.source !== undefined ? o.source : source;
    if (src) sp.set('source', src);
    const k = o.kind !== undefined ? o.kind : kind;
    if (k) sp.set('kind', k);
    const s = o.sort !== undefined ? o.sort : sort;
    const sortDefault = docSortsFor(Boolean(nq))[0].key;
    if (s && s !== sortDefault && docSortsFor(Boolean(nq)).some(x => x.key === s)) sp.set('sort', s);
    const p = o.page !== undefined ? o.page : page;
    if (p > 1) sp.set('page', String(p));
    const qs = sp.toString();
    return `/docs${qs ? '?' + qs : ''}`;
  };

  const chips: { key: string; label: string; href: string }[] = [
    ...(q ? [{ key: 'q', label: `“${q}”`, href: buildUrl({ q: null, page: 1, sort: null }) }] : []),
    ...(kind ? [{ key: 'kind', label: kindLabel, href: buildUrl({ kind: null, page: 1 }) }] : []),
    ...(source ? [{ key: 'source', label: sourceLabel, href: buildUrl({ source: null, page: 1 }) }] : []),
  ];
  const listTitle = hasQuery ? (sort === 'updated' ? 'Matches, recently updated first' : 'Best matches') : sort === 'title' ? 'All pages, A to Z' : 'Recently updated';
  if (docs.length === 0 && total > 0 && page > totalPages) redirect(buildUrl({ page: totalPages }));
  const range = docPageWindow(page, docs.length, total);
  const officialCount = kindCounts(corpusSources).official;
  const allKinds = kinds.official + kinds.ecosystem + kinds.code;

  return (
    <PageShell
      href="/docs"
      title="Documentation"
      description={`Pages from ${corpusSources.length.toLocaleString('en-US')} sources, kept in sync: the official NEAR documentation, documentation from teams building on NEAR, and readmes from their code. Search all of it, or start from a path below.`}
      stat={{ value: corpusTotal, unit: corpusTotal === 1 ? 'page' : 'pages' }}
      synced={glance.synced}
      source={`${corpusSources.length.toLocaleString('en-US')} ${corpusSources.length === 1 ? 'source' : 'sources'}`}
    >
      <section aria-label="Right now" className="dx-glance">
        <Link href="/docs" className="dx-glance-item">
          <span className="dx-label">This week</span>
          <span className="dx-glance-val">
            <b>{glance.updatedThisWeek.toLocaleString('en-US')}</b>
            <span>{glance.updatedThisWeek === 1 ? 'page updated upstream' : 'pages updated upstream'}</span>
          </span>
        </Link>
        {glance.newest ? (
          <Link href={`/docs/${glance.newest.id}`} className="dx-glance-item">
            <span className="dx-label">Newest</span>
            <span className="dx-glance-title">{glance.newest.title}</span>
            <span className="dx-glance-date">{formatDateLong(glance.newest.last_modified)}</span>
          </Link>
        ) : null}
        <Link href="/docs?kind=official" className="dx-glance-item">
          <span className="dx-label">Official</span>
          <span className="dx-glance-val">
            <b>{officialCount.toLocaleString('en-US')}</b>
            <span>pages from the official docs</span>
          </span>
        </Link>
      </section>

      <div className="pg-tools">
        <div className="pg-tools-row">
          <form action="/docs" method="get" role="search" className="pg-filter">
            <Search size={18} strokeWidth={1.75} aria-hidden="true" />
            <label htmlFor="docs-q" className="pg-sr">Search documentation</label>
            <input
              id="docs-q"
              name="q"
              type="search"
              defaultValue={q ?? ''}
              placeholder={`Search ${corpusTotal.toLocaleString('en-US')} pages by title or text`}
              autoComplete="off"
            />
            {source ? <input type="hidden" name="source" value={source} /> : null}
            {kind ? <input type="hidden" name="kind" value={kind} /> : null}
            <button type="submit" className="dx-go">Search</button>
          </form>
        </div>
        <div className="pg-tools-row">
          <span className="dx-label">Try</span>
          <div className="pg-chips">
            {DOC_SEARCH_SUGGESTIONS.map(w => (
              <Link key={w} href={`/docs?q=${encodeURIComponent(w)}`} className={`pg-chip${q === w ? ' pg-chip--on' : ''}`} aria-current={q === w ? 'true' : undefined}>{w}</Link>
            ))}
          </div>
          {q ? (
            <Link href={`/search?q=${encodeURIComponent(q)}`} className="dx-everywhere">
              Search docs, forum, releases and issues for “{q}”<ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </div>

      {landing ? <DocsLanding /> : null}

      {allKinds > 0 ? (
        <div className="pg-tools">
          <div className="pg-tools-row">
            <span className="dx-label" aria-hidden="true">Kind</span>
            <nav className="pg-chips" aria-label="Kind of documentation">
              <Link href={buildUrl({ kind: null, source: null, page: 1 })} className={`pg-chip${!kind ? ' pg-chip--on' : ''}`} aria-current={!kind ? 'true' : undefined}>
                All<b className="dx-n">{allKinds.toLocaleString('en-US')}</b>
              </Link>
              {DOC_KINDS.map(k => (
                <Link key={k.key} href={buildUrl({ kind: k.key, source: null, page: 1 })} className={`pg-chip${kind === k.key ? ' pg-chip--on' : ''}`} aria-current={kind === k.key ? 'true' : undefined} title={k.hint}>
                  {k.label}<b className="dx-n">{kinds[k.key].toLocaleString('en-US')}</b>
                </Link>
              ))}
            </nav>
          </div>
          <DocSourceFilter
            sources={facetSources}
            currentSource={source}
            buildUrl={(s) => buildUrl({ source: s ?? null, page: 1 })}
          />
        </div>
      ) : null}

      <section className="dx-section" aria-labelledby="docs-list-title">
        <div className="dx-listhead">
          <div className="dx-toolbar">
            <h2 id="docs-list-title" className="dx-list-title">{listTitle}</h2>
            <span className="dx-count"><b>{total.toLocaleString('en-US')}</b> {total === 1 ? 'page' : 'pages'}</span>
          </div>
          <nav className="pg-chips" aria-label="Sort">
            {sorts.map(s => (
              <Link key={s.key} href={buildUrl({ sort: s.key, page: 1 })} className={`pg-chip${sort === s.key ? ' pg-chip--on' : ''}`} aria-current={sort === s.key ? 'true' : undefined}>
                {s.label}
              </Link>
            ))}
          </nav>
        </div>

        {chips.length > 0 && docs.length > 0 ? (
          <div className="dx-active">
            <span className="dx-label">Showing</span>
            {chips.map(c => (
              <Link key={c.key} href={c.href} className="pg-chip pg-chip--on" aria-label={`Remove ${c.key === 'q' ? 'search' : c.key} ${c.label}`}>
                {c.label}<span aria-hidden="true" className="dx-x">×</span>
              </Link>
            ))}
          </div>
        ) : null}

        <div className="dx-results">
          <PgList
            empty={docs.length === 0 ? (
              <div className="pg-empty dx-empty">
                <EmptyAnimation />
                <p>
                  No pages match {q ? <>“{q}”</> : 'these filters'}{kind ? <> in {kindLabel}</> : null}{source ? <> from {sourceLabel}</> : null}.
                </p>
                <div className="dx-active dx-active--center">
                  {chips.filter(c => c.key !== 'q').map(c => (
                    <Link key={c.key} href={c.href} className="pg-chip">
                      Remove {c.key}<span aria-hidden="true" className="dx-x">×</span>
                    </Link>
                  ))}
                  {q ? <Link href={`/search?q=${encodeURIComponent(q)}`} className="pg-chip">Search the whole site</Link> : null}
                </div>
              </div>
            ) : null}
          >
            {docs.map((d, i) => (
              <DocCard key={d.id} doc={d} query={q} delay={i * 30} line={q ? snippet(cleanDocText(d.body_head || d.excerpt), q, 180) : cleanDocText(d.excerpt)} />
            ))}
          </PgList>
        </div>

        {totalPages > 1 ? (
          <nav className="dx-pager" aria-label="Pages">
            {page > 1
              ? <Link href={buildUrl({ page: page - 1 })} className="dx-pg" rel="prev"><ChevronLeft size={14} strokeWidth={1.75} aria-hidden="true" />Prev</Link>
              : <span className="dx-pg" aria-disabled="true"><ChevronLeft size={14} strokeWidth={1.75} aria-hidden="true" />Prev</span>
            }
            {docPageNumbers(page, totalPages).map((p, i) => p === null
              ? <span key={`gap-${i}`} className="dx-gap" aria-hidden="true">…</span>
              : <Link key={p} href={buildUrl({ page: p })} className={`dx-pg dx-pg-num${p === page ? ' dx-pg--on' : ''}`} aria-current={p === page ? 'page' : undefined}>{p}</Link>
            )}
            <span className="dx-pg-of">Page {page} of {totalPages}</span>
            {page < totalPages
              ? <Link href={buildUrl({ page: page + 1 })} className="dx-pg" rel="next">Next<ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" /></Link>
              : <span className="dx-pg" aria-disabled="true">Next<ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" /></span>
            }
          </nav>
        ) : null}
      </section>

      {totalPages > 1 ? (
        <div className="pg-foot">
          <span>Showing {range.from.toLocaleString('en-US')} to {range.to.toLocaleString('en-US')} of {total.toLocaleString('en-US')}</span>
          <Link href="/search">Search all sources →</Link>
        </div>
      ) : (
        <PgFoot shown={docs.length} total={total} />
      )}
    </PageShell>
  );
}
