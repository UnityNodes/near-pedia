import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { getDb } from '@/lib/db';
import { pageMetadata } from '@/lib/seo';
import type { Tone } from '@/lib/status';
import { PageShell, PgFoot, PgList } from '@/components/page-shell';
import './design.css';

export const revalidate = 900;

export const metadata = pageMetadata({
  title: 'Trending',
  description: 'Top trending topics and discussions in the YourChain ecosystem this week.',
  path: '/trending',
});

const SOURCES: Record<string, { label: string; tone: Tone }> = {
  forum:  { label: 'FORUM',  tone: 'info' },
  mail:   { label: 'MAIL',   tone: 'ok' },
  cip:    { label: 'CIP',    tone: 'lime' },
  github: { label: 'GITHUB', tone: 'mute' },
};

const PODIUM_SIZE = 3;
const MIN_BAR_PERCENT = 4;
const MAX_STAGGER_ROWS = 16;
const STAGGER_MS = 30;

interface TrendingItem {
  src: string;
  id: string;
  title: string;
  path: string;
  score: number;
}

function getTrending(): { items: TrendingItem[]; updatedAt: string | null } {
  const db = getDb();
  const row = db.prepare('SELECT payload, updated_at FROM trending_snapshot WHERE id = 1').get() as
    { payload: string; updated_at: string } | undefined;
  if (!row) return { items: [], updatedAt: null };
  return { items: JSON.parse(row.payload) as TrendingItem[], updatedAt: row.updated_at };
}

function ScoreBar({ score, max }: { score: number; max: number }) {
  const percent = max > 0 ? Math.max(MIN_BAR_PERCENT, Math.round((score / max) * 100)) : MIN_BAR_PERCENT;
  return (
    <span className="tr-score">
      <span className="tr-bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>
      <span className="tr-score-n"><span className="pg-sr">Score </span>{score}</span>
    </span>
  );
}

function SourceTag({ src }: { src: string }) {
  const source = SOURCES[src] ?? { label: src.toUpperCase(), tone: 'mute' as Tone };
  return <span className="pg-tag" data-tone={source.tone}>{source.label}</span>;
}

function isExternal(path: string): boolean {
  return /^https?:\/\//.test(path);
}

function ItemLink({ item, className, style, rank, children }: {
  item: TrendingItem;
  className: string;
  style?: CSSProperties;
  rank?: number;
  children: ReactNode;
}) {
  return isExternal(item.path) ? (
    <a href={item.path} className={className} style={style} data-rank={rank} target="_blank" rel="noopener noreferrer">{children}</a>
  ) : (
    <Link href={item.path} className={className} style={style} data-rank={rank}>{children}</Link>
  );
}

export default function TrendingPage() {
  const { items, updatedAt } = getTrending();
  const maxScore = items.length > 0 ? items[0].score : 1;

  const podium = items.slice(0, PODIUM_SIZE);
  const ranked = items.slice(PODIUM_SIZE);

  return (
    <PageShell
      href="/trending"
      title="Trending"
      description="The highest-activity content in the YourChain ecosystem this week, refreshed every 15 minutes."
      stat={{ value: items.length, unit: items.length === 1 ? 'entry' : 'entries' }}
      synced={updatedAt}
      source="trending snapshot"
    >
      <div className="pg-tools">
        <div className="pg-tools-row">
          <nav className="pg-chips" aria-label="Feed view">
            <Link href="/feed" className="pg-chip">Latest</Link>
            <span className="pg-chip pg-chip--on" aria-current="page">Top</span>
          </nav>
        </div>
      </div>

      {items.length === 0 ? (
        <PgList
          empty={(
            <div className="pg-empty">
              <p>No trending data yet. Run <code>scripts/refresh-trending.ts</code> to populate.</p>
            </div>
          )}
        >
          {null}
        </PgList>
      ) : (
        <>
          <section className="tr-podium" aria-label="Top three">
            {podium.map((item, i) => (
              <ItemLink
                key={`${item.src}-${item.id}`}
                item={item}
                className="pg-card tr-card"
                style={{ animationDelay: `${i * 60}ms` }}
                rank={i + 1}
              >
                <span className="tr-card-top">
                  <span className="tr-rank">{i + 1}</span>
                  <SourceTag src={item.src} />
                </span>
                <b className="tr-title">{item.title}</b>
                <span className="tr-card-foot"><ScoreBar score={item.score} max={maxScore} /></span>
              </ItemLink>
            ))}
          </section>

          {ranked.length > 0 ? (
            <section aria-label="More trending">
              <PgList>
                {ranked.map((item, i) => (
                  <ItemLink
                    key={`${item.src}-${item.id}`}
                    item={item}
                    className="pg-row"
                    style={{ animationDelay: `${Math.min(i, MAX_STAGGER_ROWS) * STAGGER_MS}ms` }}
                  >
                    <div className="pg-row-main">
                      <div className="pg-row-top">
                        <span className="pg-row-meta tr-rank-sm">#{i + PODIUM_SIZE + 1}</span>
                        <SourceTag src={item.src} />
                      </div>
                      <div className="pg-row-title">{item.title}</div>
                    </div>
                    <div className="pg-row-end">
                      <ScoreBar score={item.score} max={maxScore} />
                      <span className="pg-row-go" aria-hidden="true">{isExternal(item.path) ? '↗' : '→'}</span>
                    </div>
                  </ItemLink>
                ))}
              </PgList>
            </section>
          ) : null}

          <PgFoot shown={items.length} total={items.length} />
        </>
      )}
    </PageShell>
  );
}
