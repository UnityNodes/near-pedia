import Link from 'next/link';
import { Search as SearchIcon } from 'lucide-react';
import { FilterPill } from '@/components/ui/filter-pill';
import { PgList, PgRow, type Tone } from '@/components/page-shell';
import { headers } from 'next/headers';
import { unifiedSearch } from '@/lib/search';
import { logSearch } from '@/lib/search-stats';
import { classifyUserAgent } from '@/lib/user-agent-classify';
import type { SearchResult, SearchResultType } from '@/lib/search';
import type { Metadata } from 'next';

export const revalidate = 300;

interface PageProps {
  searchParams: Promise<{ q?: string; type?: string }>;
}

const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'cip', label: 'CIPs' },
  { value: 'discussion', label: 'Forum' },
  { value: 'doc', label: 'Docs' },
  { value: 'whitepaper', label: 'Papers' },
  { value: 'blog', label: 'Blog/News' },
  { value: 'youtube', label: 'Videos' },
  { value: 'github', label: 'GitHub' },
];

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { q } = await searchParams;
  return {
    title: q ? `"${q}", Search` : 'Search',
    description: 'Search across CIPs, discussions, documentation, blog posts, videos and GitHub issues.',
    robots: { index: false, follow: true },
  };
}

const TYPE_CONFIG: Record<SearchResultType, { label: string; tone: Tone; href?: (r: SearchResult) => string }> = {
  cip:        { label: 'CIP',        tone: 'lime' },
  discussion: { label: 'Discussion', tone: 'info' },
  doc:        { label: 'Doc',        tone: 'ok' },
  whitepaper: { label: 'Whitepaper', tone: 'mute' },
  youtube:    { label: 'Video',      tone: 'info', href: (r) => `/videos/${r.id}` },
  github:     { label: 'GitHub',     tone: 'mute' },
  blog:       { label: 'Blog',       tone: 'mute' },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildHighlightedHtml(text: string, query: string): string {
  const safe = escapeHtml(text);
  if (!query) return safe;
  const words = query.trim().split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return safe;
  const pattern = words.map(escapeRegex).join('|');
  const re = new RegExp(`(${pattern})`, 'gi');
  return safe.replace(re, '<mark class="search-hl">$1</mark>');
}

function HighlightedText({ text, query, className }: { text: string; query: string; className?: string }) {
  const html = buildHighlightedHtml(text, query);
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default async function SearchPage({ searchParams }: PageProps) {
  const { q, type: typeParam } = await searchParams;
  const query = q?.trim() ?? '';
  const activeType = FILTER_OPTIONS.some(o => o.value === typeParam) ? (typeParam ?? '') : '';

  const all = query ? unifiedSearch(query) : { results: [], total: 0 };
  const filteredResults = activeType
    ? all.results.filter(r => r.type === activeType)
    : all.results;
  const total = activeType ? filteredResults.length : all.total;
  const results = filteredResults;

  if (query) {
    const h = await headers();
    const agentClass = classifyUserAgent(h.get('user-agent'));
    // Don't count bot scans - analytics here is about user intent.
    if (agentClass === 'human' || agentClass === 'unknown') {
      // Always log the unfiltered total - analytics is about the
      // shape of the corpus, not the user's current filter choice.
      logSearch(query, all.total, agentClass);
    }
  }

  const grouped = results.reduce<Partial<Record<SearchResultType, SearchResult[]>>>((acc, r) => {
    (acc[r.type] ??= []).push(r);
    return acc;
  }, {});

  const order: SearchResultType[] = ['cip', 'discussion', 'doc', 'whitepaper', 'blog', 'youtube', 'github'];

  const buildUrl = (typeValue: string): string => {
    const sp = new URLSearchParams();
    if (query) sp.set('q', query);
    if (typeValue) sp.set('type', typeValue);
    return `/search${sp.toString() ? '?' + sp.toString() : ''}`;
  };

  return (
    <main className="pg">
      <nav className="pg-crumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Search</span>
      </nav>
      <div className="pg-main pg-solo">
        <header className="pg-head">
          <div className="pg-head-copy">
            <div className="pg-head-top">
              <span className="pg-icon"><SearchIcon size={22} aria-hidden="true" /></span>
              <span className="pg-kicker">SEARCH · EVERY SOURCE</span>
            </div>
            <h1 className="pg-h1">Search</h1>
            <p className="pg-desc">One query across proposals, docs, discussions, papers, posts, videos and code.</p>
          </div>
        </header>

        <form method="get" action="/search" className="dp-search pg-search">
          <SearchIcon size={18} aria-hidden="true" />
          <input
            name="q"
            defaultValue={query}
            placeholder="Search CIPs, discussions, docs, videos, GitHub..."
            aria-label="Search the index"
            autoFocus
          />
          <button type="submit" aria-label="Search">→</button>
        </form>

        {query && (
          <>
            <div className="pg-chips">
              {FILTER_OPTIONS.map(opt => {
                const count = opt.value
                  ? all.results.filter(r => r.type === opt.value).length
                  : all.total;
                if (opt.value && count === 0) return null;
                const isActive = (opt.value || '') === activeType;
                return (
                  <FilterPill key={opt.value || 'all'} href={buildUrl(opt.value)} active={isActive}>
                    {opt.label} <span className="soft-count">{count}</span>
                  </FilterPill>
                );
              })}
            </div>
            <div className="pg-foot">
              <span>
                {total.toLocaleString('en-US')} {activeType ? `${activeType} ` : ''}results for &ldquo;{query}&rdquo;
                {activeType && (
                  <>
                    {' · '}
                    <Link href={buildUrl('')} prefetch={false} className="pg-link">clear filter</Link>
                  </>
                )}
              </span>
            </div>
          </>
        )}

        {query && total === 0 && (
          <div className="pg-list">
            <div className="pg-empty">No results for &ldquo;{query}&rdquo;. Try a CIP number, a term or a source name.</div>
          </div>
        )}

        {query && total > 0 && order.map(type => {
          const group = grouped[type];
          if (!group?.length) return null;
          const cfg = TYPE_CONFIG[type];
          return (
            <section key={type} className="pg-group" aria-label={`${cfg.label} results`}>
              <div className="pg-group-head">
                <span className="pg-kicker">{cfg.label.toUpperCase()}</span>
                <span className="pg-row-meta">{group.length} result{group.length !== 1 ? 's' : ''}</span>
              </div>
              <PgList>
                {group.map((r, i) => {
                  const href = cfg.href ? cfg.href(r) : r.url;
                  const external = href.startsWith('http') && !href.startsWith('/');
                  return (
                    <PgRow
                      key={r.id}
                      href={href}
                      external={external}
                      tag={cfg.label}
                      tone={cfg.tone}
                      meta={r.meta ?? undefined}
                      title={<HighlightedText text={r.title} query={query} />}
                      sub={r.excerpt ? <HighlightedText text={r.excerpt} query={query} /> : undefined}
                      delay={Math.min(i, 8) * 30}
                    />
                  );
                })}
              </PgList>
            </section>
          );
        })}

        {!query && (
          <div className="pg-chips" aria-label="Indexed sources">
            {order.map(type => (
              <span key={type} className="pg-tag" data-tone={TYPE_CONFIG[type].tone}>{TYPE_CONFIG[type].label}s</span>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
