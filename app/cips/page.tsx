import { getCips, getDistinctTypes, getCipAttachmentCounts, getCipStatusCounts, getCipsTotalCount, getKindCounts, getLatestStatusChanges, getNewestCip } from '@/lib/cips';
import type { CipKind } from '@/lib/cips';
import { CipCard } from '@/components/cip-card';
import { CipTypeFilter } from '@/components/cip-filters';
import { CipStatusFacets } from '@/components/cip-status-facets';
import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, GitPullRequest, History, List, Network, Search } from 'lucide-react';
import { EmptyAnimation } from '@/components/resources-empty-animation';
import { PageShell, PgFoot, PgList, PgRow } from '@/components/page-shell';
import { getDb } from '@/lib/db';
import { pageMetadata } from '@/lib/seo';
import { getLastSync } from '@/lib/section-counts';
import { statusTone } from '@/lib/status';
import { CIP_SEARCH_SUGGESTIONS, activeFilters, cipLabel, inProgress, pageWindow } from '@/lib/cips-browse';
import { formatDateLong } from '@/lib/utils';
import './design.css';

export const revalidate = 300;

export const metadata = pageMetadata({
  title: 'CIP Browser',
  description: 'Search and filter every Chain Improvement Proposal by number, title, author, status or type, follow each status change, and see how proposals depend on each other.',
  path: '/cips',
});

interface PageProps {
  searchParams: Promise<{ q?: string; status?: string; type?: string; page?: string; view?: string; sort?: string }>;
}

interface ChangeRow {
  id: number;
  cip_id: string;
  cip_number: number | null;
  title: string | null;
  from_status: string | null;
  to_status: string;
  changed_at: string;
}

function getChanges(limit = 200, numberedOnly = false): ChangeRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT h.id, h.cip_id, c.cip_number, c.title, h.from_status, h.to_status, h.changed_at
    FROM cip_status_history h
    LEFT JOIN cips c ON c.id = h.cip_id
    ${numberedOnly ? 'WHERE c.cip_number IS NOT NULL' : ''}
    ORDER BY h.changed_at DESC
    LIMIT ?
  `).all(limit) as ChangeRow[];
}

const SORTS: { key: 'newest' | 'oldest' | 'title' | 'author'; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'title', label: 'A-Z' },
  { key: 'author', label: 'Author' },
];

export default async function CipsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const view = params.view === 'changes' ? 'changes' : params.view === 'prs' ? 'prs' : 'cips';
  const listing = view === 'cips' || view === 'prs';
  const kind: CipKind = view === 'prs' ? 'pr' : 'cip';
  const page = parseInt(params.page ?? '1', 10);
  const sort = (params.sort ?? 'newest') as 'newest' | 'oldest' | 'title' | 'author';

  const { cips, total, totalPages } = listing
    ? getCips({ q: params.q, status: params.status, type: params.type, kind, sort, page })
    : { cips: [], total: 0, totalPages: 0 };

  const types = getDistinctTypes(kind);
  const statusCounts = listing ? getCipStatusCounts(kind) : [];
  const kindCounts = getKindCounts();
  const corpusTotal = getCipsTotalCount(kind);
  const base = view === 'prs' ? '/cips?view=prs' : '/cips';
  const changes = view === 'changes' ? getChanges() : [];
  const attachmentCounts = listing ? getCipAttachmentCounts() : new Map<string, number>();
  const statusChanges = getLatestStatusChanges(cips.map(c => c.id));

  const hasFilters = Boolean(params.q || params.status || params.type);

  const buildUrl = (overrides: { page?: number; sort?: string; status?: string | null; type?: string | null } = {}) => {
    const sp = new URLSearchParams();
    if (view === 'prs') sp.set('view', 'prs');
    if (params.q) sp.set('q', params.q);
    const st = overrides.status !== undefined ? overrides.status : params.status;
    if (st) sp.set('status', st);
    const ty = overrides.type !== undefined ? overrides.type : params.type;
    if (ty) sp.set('type', ty);
    const sr = overrides.sort !== undefined ? overrides.sort : sort;
    if (sr && sr !== 'newest') sp.set('sort', sr);
    const p = overrides.page !== undefined ? overrides.page : page;
    if (p > 1) sp.set('page', String(p));
    const qs = sp.toString();
    return `/cips${qs ? '?' + qs : ''}`;
  };

  const latest = getChanges(1, true)[0];
  const newest = getNewestCip('cip');
  const prStatusCounts = view === 'cips' ? getCipStatusCounts('pr') : [];
  const progress = inProgress(statusCounts);
  const filters = activeFilters(params);
  const range = pageWindow(page, cips.length, total);
  const noun = view === 'prs' ? 'pull request' : 'proposal';

  const filterLabel = (f: { key: 'q' | 'status' | 'type'; value: string }) => f.key === 'q' ? `“${f.value}”` : f.value;
  const withoutFilter = (key: 'q' | 'status' | 'type') => {
    const sp = new URLSearchParams();
    if (view === 'prs') sp.set('view', 'prs');
    if (key !== 'q' && params.q) sp.set('q', params.q);
    if (key !== 'status' && params.status) sp.set('status', params.status);
    if (key !== 'type' && params.type) sp.set('type', params.type);
    const qs = sp.toString();
    return `/cips${qs ? '?' + qs : ''}`;
  };

  const description = view === 'prs' ? (
    <>
      {kindCounts.pr.toLocaleString()} open pull requests against the CIPs repository. A pull request
      becomes a proposal once it is merged and numbered, and some change other files, such as the readme.
    </>
  ) : (
    <>
      {kindCounts.cip.toLocaleString()} Chain Improvement Proposals in every state, from Draft to Final,
      Withdrawn and Rejected. Search them, filter by status or type, follow each status change, or trace
      how they depend on each other. Open pull requests that may become proposals are listed separately.
    </>
  );

  const stat = view === 'prs'
    ? { value: kindCounts.pr, unit: kindCounts.pr === 1 ? 'pull request' : 'pull requests' }
    : view === 'changes'
      ? { value: changes.length, unit: changes.length === 1 ? 'status change' : 'status changes' }
      : { value: kindCounts.cip, unit: kindCounts.cip === 1 ? 'proposal' : 'proposals' };

  return (
    <PageShell
      href="/cips"
      title="CIPs"
      description={description}
      stat={stat}
      synced={getLastSync('cips')}
      source="cips"
    >
      <nav className="pg-chips" aria-label="View">
        <Link href="/cips" className={`pg-chip cp-chip${view === 'cips' ? ' pg-chip--on' : ''}`} aria-current={view === 'cips' ? 'page' : undefined}>
          <List size={14} strokeWidth={1.75} aria-hidden="true" />CIPs<span className="cp-n">{kindCounts.cip}</span>
        </Link>
        <Link href="/cips?view=prs" className={`pg-chip cp-chip${view === 'prs' ? ' pg-chip--on' : ''}`} aria-current={view === 'prs' ? 'page' : undefined}>
          <GitPullRequest size={14} strokeWidth={1.75} aria-hidden="true" />Pull requests<span className="cp-n">{kindCounts.pr}</span>
        </Link>
        <Link href="/cips?view=changes" className={`pg-chip cp-chip${view === 'changes' ? ' pg-chip--on' : ''}`} aria-current={view === 'changes' ? 'page' : undefined}>
          <History size={14} strokeWidth={1.75} aria-hidden="true" />Changes
        </Link>
        <Link href="/cips/graph" className="pg-chip cp-chip">
          <Network size={14} strokeWidth={1.75} aria-hidden="true" />Graph
        </Link>
      </nav>

      {view === 'cips' ? (
        <section aria-label="Right now" className="cp-glance">
          <div className="pg-card cp-static">
            <span className="cp-glance-k">In progress</span>
            <b>{progress.total}</b>
            {progress.parts.length > 0 ? <p>{progress.parts.map(p => `${p.status} ${p.count}`).join(', ')}</p> : null}
          </div>
          {kindCounts.pr > 0 ? (
            <Link href="/cips?view=prs" className="pg-card">
              <span className="cp-glance-k">Open PRs</span>
              <b>{kindCounts.pr}</b>
              <p>{prStatusCounts.map(p => `${p.status} ${p.count}`).join(', ')}</p>
            </Link>
          ) : null}
          {latest ? (
            <Link href={`/cips/${latest.cip_id}`} className="pg-card">
              <span className="cp-glance-k">Last change</span>
              <b>{cipLabel(latest.cip_number, latest.cip_id)}</b>
              <p>{latest.from_status ? `${latest.from_status} to ${latest.to_status}` : `Now ${latest.to_status}`}, {formatDateLong(latest.changed_at)}</p>
            </Link>
          ) : null}
          {newest ? (
            <Link href={`/cips/${newest.id}`} className="pg-card">
              <span className="cp-glance-k">Newest</span>
              <b>{cipLabel(newest.cip_number, newest.pr_number ?? newest.id)}</b>
              <p>{newest.title ?? '(untitled)'}</p>
            </Link>
          ) : null}
        </section>
      ) : null}

      {listing ? (
        <>
          <div className="pg-tools">
            <div className="pg-tools-row">
              <form action="/cips" method="get" role="search" className="pg-filter cp-search">
                <Search size={18} strokeWidth={1.75} aria-hidden="true" />
                <label htmlFor="cip-q" className="pg-sr">Search {noun}s</label>
                <input
                  id="cip-q"
                  name="q"
                  type="search"
                  defaultValue={params.q ?? ''}
                  placeholder={view === 'prs' ? `Search ${corpusTotal.toLocaleString()} pull requests by title or author` : `Search ${corpusTotal.toLocaleString()} proposals by number, title or author`}
                  autoComplete="off"
                />
                {view === 'prs' ? <input type="hidden" name="view" value="prs" /> : null}
                {params.status ? <input type="hidden" name="status" value={params.status} /> : null}
                {params.type ? <input type="hidden" name="type" value={params.type} /> : null}
                {sort !== 'newest' ? <input type="hidden" name="sort" value={sort} /> : null}
                <button type="submit" className="pg-btn cp-go">Search</button>
              </form>
              <Suspense>
                <CipTypeFilter types={types} currentType={params.type} />
              </Suspense>
            </div>
            <CipStatusFacets
              counts={statusCounts}
              total={corpusTotal}
              current={params.status}
              buildUrl={(status) => buildUrl({ status: status ?? null, page: 1 })}
            />
            <div className="cp-try">
              <span className="cp-label">Try</span>
              {CIP_SEARCH_SUGGESTIONS.map(w => (
                <Link
                  key={w}
                  href={`/cips?${view === 'prs' ? 'view=prs&' : ''}q=${encodeURIComponent(w)}`}
                  className={`pg-chip${params.q === w ? ' pg-chip--on' : ''}`}
                  aria-current={params.q === w ? 'true' : undefined}
                >
                  {w}
                </Link>
              ))}
            </div>
          </div>

          <div className="cp-bar">
            <span className="cp-count">
              <span><b>{total.toLocaleString()}</b> {total === 1 ? noun : `${noun}s`}</span>
              {hasFilters && <Link href={base} className="cp-clear">Clear filters</Link>}
            </span>
            <nav className="cp-sort" aria-label="Sort">
              <span className="cp-label">Sort</span>
              {SORTS.map(sortOption => (
                <Link
                  key={sortOption.key}
                  href={buildUrl({ sort: sortOption.key, page: 1 })}
                  className={`pg-chip${sort === sortOption.key ? ' pg-chip--on' : ''}`}
                  aria-current={sort === sortOption.key ? 'true' : undefined}
                >
                  {sortOption.label}
                </Link>
              ))}
            </nav>
          </div>

          {filters.length > 0 && cips.length > 0 ? (
            <div className="cp-active">
              <span className="cp-label">Showing</span>
              {filters.map(f => (
                <Link key={f.key} href={withoutFilter(f.key)} className="pg-chip cp-chip cp-x" aria-label={`Remove ${f.label} filter ${f.value}`}>
                  {filterLabel(f)}<span aria-hidden="true" className="cp-x-mark">×</span>
                </Link>
              ))}
            </div>
          ) : null}

          <h2 className="pg-sr">{view === 'prs' ? 'Pull requests' : 'Proposals'}</h2>
          <PgList
            empty={cips.length === 0 ? (
              <div className="pg-empty cp-empty">
                <EmptyAnimation />
                <p>No {view === 'prs' ? 'pull requests' : 'proposals'} match {filters.length > 0 ? filters.map(f => filterLabel(f)).join(' and ') : 'these filters'}.</p>
                <div className="cp-active">
                  {filters.map(f => (
                    <Link key={f.key} href={withoutFilter(f.key)} className="pg-chip cp-chip cp-x" aria-label={`Remove ${f.label} filter ${f.value}`}>
                      Remove {f.label.toLowerCase()}<span aria-hidden="true" className="cp-x-mark">×</span>
                    </Link>
                  ))}
                  <Link href={base} className="pg-chip cp-chip">Clear all</Link>
                </div>
              </div>
            ) : null}
          >
            {cips.map((cip, i) => (
              <CipCard key={cip.id} cip={cip} attachmentCount={attachmentCounts.get(cip.id) ?? 0} change={statusChanges.get(cip.id)} delay={i * 30} />
            ))}
          </PgList>

          {totalPages > 1 && (
            <nav className="cp-pager" aria-label="Pages">
              {page > 1
                ? <Link href={buildUrl({ page: page - 1 })} className="pg-chip cp-chip" rel="prev"><ChevronLeft size={14} strokeWidth={1.75} aria-hidden="true" />Prev</Link>
                : <span className="pg-chip cp-chip" aria-disabled="true"><ChevronLeft size={14} strokeWidth={1.75} aria-hidden="true" />Prev</span>
              }
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                const p = page <= 4 ? i + 1 : page - 3 + i;
                if (p < 1 || p > totalPages) return null;
                return <Link key={p} href={buildUrl({ page: p })} className={`pg-chip cp-chip${p === page ? ' pg-chip--on' : ''}`} aria-current={p === page ? 'page' : undefined}>{p}</Link>;
              })}
              <span className="cp-of">Page {page} of {totalPages}, rows {range.from} to {range.to}</span>
              {page < totalPages
                ? <Link href={buildUrl({ page: page + 1 })} className="pg-chip cp-chip" rel="next">Next<ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" /></Link>
                : <span className="pg-chip cp-chip" aria-disabled="true">Next<ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" /></span>
              }
            </nav>
          )}
          <PgFoot shown={cips.length} total={total} />
        </>
      ) : (
        <>
          <div className="cp-bar">
            <span className="cp-count"><span><b>{changes.length}</b> latest status transitions</span></span>
            <span className="cp-count">updated on every sync</span>
          </div>
          <PgList empty={changes.length === 0 ? <div className="pg-empty">No status changes recorded yet.</div> : null}>
            {changes.map((row, i) => (
              <PgRow
                key={row.id}
                href={`/cips/${row.cip_id}`}
                tag={row.to_status}
                tone={statusTone(row.to_status)}
                meta={`${cipLabel(row.cip_number, row.cip_id)} · ${row.from_status ? `${row.from_status} to ${row.to_status}` : 'New'}`}
                title={row.title ?? '-'}
                date={formatDateLong(row.changed_at)}
                delay={Math.min(i, 12) * 30}
              />
            ))}
          </PgList>
          <PgFoot shown={changes.length} total={changes.length} />
        </>
      )}
    </PageShell>
  );
}
