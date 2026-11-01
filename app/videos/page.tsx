import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Search } from 'lucide-react';
import { getChannelCounts, getVideos, getVideosGlance, parseVideoPage, parseVideoSort } from '@/lib/videos';
import type { VideoSort } from '@/lib/videos';
import { VideoCard } from '@/components/video-card';
import { EmptyAnimation } from '@/components/resources-empty-animation';
import { PageShell, PgFoot } from '@/components/page-shell';
import { PgPager } from '@/components/pg-pager';
import { pageMetadata } from '@/lib/seo';
import { firstValues } from '@/lib/search-params';
import { formatDateLong } from '@/lib/utils';
import { getLastSync } from '@/lib/section-counts';
import { channelNamesText } from '@/lib/video-channels';
import './design.css';

export const revalidate = 300;

export const metadata = pageMetadata({
  title: 'Videos',
  description: `Talks, tutorials and demos from ${channelNamesText()}, with searchable transcripts.`,
  path: '/videos',
});

const PER_PAGE = 24;
const SEARCH_TRY = ['tutorial', 'demo', 'overview', 'release', 'roadmap'];

interface PageProps {
  searchParams: Promise<{ q?: string; channel?: string; sort?: string; page?: string }>;
}

type Overrides = { q?: string | null; channel?: string | null; sort?: VideoSort | null; page?: number };

export default async function VideosPage({ searchParams }: PageProps) {
  const params = firstValues(await searchParams);
  const q = params.q?.trim().slice(0, 120) || undefined;
  const hasQuery = Boolean(q);
  const page = parseVideoPage(params.page);
  const sort = parseVideoSort(params.sort, hasQuery);
  const matching = getChannelCounts(q);
  const channel = getChannelCounts().some(c => c.name === params.channel) ? params.channel : undefined;
  const channels = channel && !matching.some(c => c.name === channel) ? [...matching, { name: channel, count: 0 }] : matching;
  const glance = getVideosGlance();

  const { videos, total, totalPages } = getVideos({ channel, q, sort, page, perPage: PER_PAGE });
  const allCount = channels.reduce((n, c) => n + c.count, 0);

  const sorts: { key: VideoSort; label: string }[] = [
    ...(hasQuery ? [{ key: 'relevance' as const, label: 'Best match' }] : []),
    { key: 'newest', label: 'Newest' },
    { key: 'oldest', label: 'Oldest' },
  ];

  const buildUrl = (o: Overrides = {}) => {
    const sp = new URLSearchParams();
    const nq = o.q !== undefined ? o.q : q;
    if (nq) sp.set('q', nq);
    const ch = o.channel !== undefined ? o.channel : channel;
    if (ch) sp.set('channel', ch);
    const s = o.sort !== undefined ? o.sort : sort;
    const sortDefault = parseVideoSort(undefined, Boolean(nq));
    if (s && s !== sortDefault && (s !== 'relevance' || nq)) sp.set('sort', s);
    const p = o.page ?? 1;
    if (p > 1) sp.set('page', String(p));
    const qs = sp.toString();
    return `/videos${qs ? `?${qs}` : ''}`;
  };

  if (videos.length === 0 && total > 0 && page > totalPages) redirect(buildUrl({ page: totalPages }));

  const listTitle = hasQuery
    ? (sort === 'relevance' ? 'Best matches' : sort === 'oldest' ? 'Matches, oldest first' : 'Matches, newest first')
    : sort === 'oldest' ? 'All videos, oldest first' : 'All videos, newest first';
  const chips = [
    ...(q ? [{ key: 'search', label: `“${q}”`, href: buildUrl({ q: null, sort: null }) }] : []),
    ...(channel ? [{ key: 'channel', label: channel, href: buildUrl({ channel: null }) }] : []),
  ];

  return (
    <PageShell
      href="/videos"
      title="Videos"
      description={<>
        Talks, tutorials and demos from {channelNamesText()}.
        {' '}{glance.withTranscript.toLocaleString('en-US')} of them come with a transcript that you can search here, read
        line by line with the time of each line, or fetch through MCP.
      </>}
      stat={{ value: glance.total, unit: glance.total === 1 ? 'video' : 'videos' }}
      synced={getLastSync('youtube_videos')}
      source="youtube_videos"
    >
      {glance.newest ? (
        <section className="pg-feature" aria-labelledby="vid-newest">
          <h2 id="vid-newest">Newest video</h2>
          <Link href={`/videos/${glance.newest.id}`} className="pg-feature-title">{glance.newest.title}</Link>
          <span className="pg-feature-meta">
            <time dateTime={glance.newest.published_at ?? undefined}>{formatDateLong(glance.newest.published_at)}</time>
            <span aria-hidden="true">·</span>
            <span>{glance.withTranscript.toLocaleString('en-US')} of {glance.total.toLocaleString('en-US')} with a transcript</span>
            {glance.checkedAt ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Last check {formatDateLong(glance.checkedAt)}, {glance.checkedAt.slice(11, 16)} UTC, then every 6 hours</span>
              </>
            ) : null}
          </span>
        </section>
      ) : null}

      <div className="pg-tools">
        <div className="pg-tools-row">
          <form action="/videos" method="get" role="search" className="pg-filter">
            <Search size={16} strokeWidth={1.75} aria-hidden="true" />
            <label htmlFor="videos-q" className="pg-sr">Search videos</label>
            <input
              id="videos-q"
              name="q"
              type="search"
              defaultValue={q ?? ''}
              placeholder={`Search ${glance.total.toLocaleString('en-US')} videos by title or by what is said`}
              autoComplete="off"
            />
            {channel ? <input type="hidden" name="channel" value={channel} /> : null}
            <button type="submit" className="pg-filter-go">Search</button>
          </form>
        </div>

        {channels.length > 0 ? (
          <nav className="pg-chips" aria-label="Channel">
            <Link href={buildUrl({ channel: null })} className={`pg-chip${!channel ? ' pg-chip--on' : ''}`} aria-current={!channel ? 'true' : undefined}>
              All<span className="pg-chip-n">{allCount.toLocaleString('en-US')}</span>
            </Link>
            {channels.map(c => (
              <Link key={c.name} href={buildUrl({ channel: c.name })} className={`pg-chip${channel === c.name ? ' pg-chip--on' : ''}`} aria-current={channel === c.name ? 'true' : undefined}>
                {c.name}<span className="pg-chip-n">{c.count.toLocaleString('en-US')}</span>
              </Link>
            ))}
          </nav>
        ) : null}

        <div className="pg-tools-row">
          <span className="pg-label">Try</span>
          <div className="pg-chips">
            {SEARCH_TRY.map(w => (
              <Link key={w} href={`/videos?q=${encodeURIComponent(w)}`} className={`pg-chip${q === w ? ' pg-chip--on' : ''}`} aria-current={q === w ? 'true' : undefined}>{w}</Link>
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

      <section className="pg-tools" aria-labelledby="videos-list-title">
        <div className="pg-listhead">
          <h2 id="videos-list-title">{listTitle}</h2>
          <span><b>{total.toLocaleString('en-US')}</b> {total === 1 ? 'video' : 'videos'}</span>
        </div>

        {chips.length > 0 && videos.length > 0 ? (
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

        {videos.length === 0 ? (
          <div className="pg-list">
            <div className="pg-empty">
              <EmptyAnimation />
              <p>No videos match {q ? <>“{q}”</> : 'these filters'}{channel ? <> on {channel}</> : null}.</p>
              <div className="pg-chips">
                {chips.filter(c => c.key !== 'search').map(c => (
                  <Link key={c.key} href={c.href} className="pg-chip">
                    Remove {c.key}<span aria-hidden="true" className="pg-chip-x">×</span>
                  </Link>
                ))}
                {q ? <Link href={`/search?q=${encodeURIComponent(q)}`} className="pg-chip">Search the whole site</Link> : null}
              </div>
            </div>
          </div>
        ) : (
          <ol className="vg-grid">
            {videos.map(v => <VideoCard key={v.id} video={v} query={q} />)}
          </ol>
        )}
      </section>

      <PgPager page={page} totalPages={totalPages} hrefFor={n => buildUrl({ page: n })} />
      <PgFoot shown={videos.length} total={total} />
    </PageShell>
  );
}
