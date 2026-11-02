import Link from 'next/link';
import { getDb } from '@/lib/db';
import { formatDate } from '@/lib/utils';
import { pageMetadata } from '@/lib/seo';
import { ago } from '@/lib/home-feed';
import { getLastSync } from '@/lib/section-counts';
import { KIND_SQL } from '@/lib/blog';
import type { Tone } from '@/lib/status';
import { PageShell, PgList } from '@/components/page-shell';

export const dynamic = 'force-dynamic';

export const metadata = pageMetadata({
  title: 'Feed',
  description: 'What changed in NEAR, newest first: deprecations and doc changes, releases, forum threads, blog posts and videos.',
  path: '/feed',
});

type Range = '24h' | '7d' | '30d';

const FEED_LIMIT = 100;
const MAX_STAGGER_ROWS = 16;
const STAGGER_MS = 30;

const RANGE_SQL: Record<Range, string> = {
  '24h': "'-1 day'",
  '7d':  "'-7 days'",
  '30d': "'-30 days'",
};

const RANGES: { value: Range; label: string; window: string }[] = [
  { value: '24h', label: '24H', window: 'the last 24 hours' },
  { value: '7d',  label: '7D',  window: 'the last 7 days' },
  { value: '30d', label: '30D', window: 'the last 30 days' },
];

const SOURCES: Record<string, { label: string; tone: Tone }> = {
  change: { label: 'CHANGE', tone: 'lime' },
  forum:  { label: 'FORUM',  tone: 'info' },
  github: { label: 'RELEASE', tone: 'mute' },
  blog:   { label: 'BLOG',   tone: 'ok' },
  video:  { label: 'VIDEO',  tone: 'ok' },
};

const SYNC_TABLES = ['forum_topics', 'blog_posts', 'github_releases', 'youtube_videos'] as const;

interface PulseItem {
  src: string;
  id: string;
  title: string;
  ts: string;
  path: string;
}

function getPulse(range: Range): PulseItem[] {
  const db = getDb();
  const offset = RANGE_SQL[range];
  return db.prepare(`
    SELECT 'change' as src, CAST(id as TEXT) as id, title, observed_at as ts, COALESCE(source_url, '/deprecations') as path FROM change_events
      WHERE observed_at > datetime('now', ${offset})
    UNION ALL
    SELECT 'forum', CAST(id as TEXT), title, last_post_at, '/discussions/' || id FROM forum_topics
      WHERE last_post_at > datetime('now', ${offset})
    UNION ALL
    SELECT 'blog', id, title, published_at, '/blog/' || id FROM blog_posts
      WHERE published_at > datetime('now', ${offset}) AND ${KIND_SQL} != 'release'
    UNION ALL
    SELECT 'video', id, title, published_at, '/videos/' || id FROM youtube_videos
      WHERE published_at > datetime('now', ${offset})
    UNION ALL
    SELECT 'github', id, repo || ' ' || tag as title, published_at, url as path FROM github_releases
      WHERE published_at > datetime('now', ${offset})
    ORDER BY ts DESC
    LIMIT ${FEED_LIMIT}
  `).all() as PulseItem[];
}

function latestSync(): string | null {
  const stamps = SYNC_TABLES
    .map(table => getLastSync(table))
    .filter((stamp): stamp is string => Boolean(stamp));
  if (stamps.length === 0) return null;
  return stamps.reduce((newest, stamp) => (Date.parse(stamp) > Date.parse(newest) ? stamp : newest));
}

function FeedRow({ item, index }: { item: PulseItem; index: number }) {
  const source = SOURCES[item.src] ?? { label: item.src.toUpperCase(), tone: 'mute' as Tone };
  const external = /^https?:\/\//.test(item.path);
  const style = { animationDelay: `${Math.min(index, MAX_STAGGER_ROWS) * STAGGER_MS}ms` };
  const body = (
    <>
      <div className="pg-row-main">
        <div className="pg-row-top">
          <span className="pg-tag" data-tone={source.tone}>{source.label}</span>
        </div>
        <div className="pg-row-title">{item.title}</div>
      </div>
      <div className="pg-row-end">
        {item.ts ? (
          <time className="pg-row-date" dateTime={item.ts} title={formatDate(item.ts)}>{ago(item.ts)}</time>
        ) : null}
        <span className="pg-row-go" aria-hidden="true">{external ? '↗' : '→'}</span>
      </div>
    </>
  );
  return external ? (
    <a href={item.path} className="pg-row" style={style} target="_blank" rel="noopener noreferrer">{body}</a>
  ) : (
    <Link href={item.path} className="pg-row" style={style}>{body}</Link>
  );
}

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

export default async function PulsePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const range: Range = (['24h', '7d', '30d'].includes(params.range ?? '') ? params.range : '7d') as Range;
  const items = getPulse(range);
  const windowLabel = RANGES.find(r => r.value === range)?.window ?? 'the last 7 days';

  return (
    <PageShell
      href="/feed"
      title="Feed"
      description="What changed in NEAR, newest first: deprecations and doc changes, releases, forum threads, blog posts and videos."
      stat={{ value: items.length, unit: items.length === 1 ? 'event' : 'events' }}
      synced={latestSync()}
      source="changes · releases · forum · blog · videos"
    >
      <div className="pg-tools">
        <div className="pg-tools-row">
          <nav className="pg-chips" aria-label="Feed view">
            <span className="pg-chip pg-chip--on" aria-current="page">Latest</span>
          </nav>
          <nav className="pg-chips" aria-label="Time range">
            {RANGES.map(r => (
              <Link
                key={r.value}
                href={`/feed?range=${r.value}`}
                className={`pg-chip${r.value === range ? ' pg-chip--on' : ''}`}
                aria-current={r.value === range ? 'page' : undefined}
              >
                {r.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <PgList
        empty={items.length === 0 ? (
          <div className="pg-empty">
            <p>No activity in this period. Try 30D.</p>
          </div>
        ) : null}
      >
        {items.map((item, i) => (
          <FeedRow key={`${item.src}-${item.id}-${i}`} item={item} index={i} />
        ))}
      </PgList>

      {items.length > 0 ? (
        <div className="pg-foot">
          <span>
            {items.length === FEED_LIMIT ? `Latest ${FEED_LIMIT} events` : `${items.length} ${items.length === 1 ? 'event' : 'events'}`} in {windowLabel}
          </span>
          <Link href="/search">Search all sources →</Link>
        </div>
      ) : null}
    </PageShell>
  );
}
