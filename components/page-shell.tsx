import Link from 'next/link';
import type { ReactNode } from 'react';
import { findNavItem, NAV_GROUPS, type NavGroup } from '@/lib/nav-groups';
import { getSectionCounts } from '@/lib/section-counts';
import { ago } from '@/lib/home-feed';
import { SITE } from '@/lib/site.config';

import type { Tone } from '@/lib/status';

export type { Tone };

interface PageShellProps {
  href: string;
  title: string;
  description: ReactNode;
  kicker?: string;
  stat?: { value: number | string; unit: string };
  synced?: string | null;
  source?: string;
  children: ReactNode;
}

function Sidebar({ group, active, counts }: { group: NavGroup; active: string; counts: Record<string, number> }) {
  const others = NAV_GROUPS.filter((g) => g.key !== group.key);
  return (
    <aside className="pg-side" aria-label={`${group.label} navigation`}>
      <div className="pg-side-group">
        <span className="pg-side-label">{group.label}</span>
        {group.items.map(({ href, label, Icon }) => {
          const on = href === active;
          const n = counts[href];
          return (
            <Link key={href} href={href} className={`pg-side-item${on ? ' pg-side-item--on' : ''}`} aria-current={on ? 'page' : undefined}>
              <span><Icon size={15} aria-hidden="true" />{label}</span>
              {n !== undefined && <span className="pg-side-n">{n.toLocaleString('en-US')}</span>}
            </Link>
          );
        })}
      </div>
      <div className="pg-side-group pg-side-others">
        <span className="pg-side-label">ALSO IN {SITE.name}</span>
        {others.map((g) => (
          <Link key={g.key} href={g.items[0].href} className="pg-side-other">{g.label} →</Link>
        ))}
      </div>
    </aside>
  );
}

export function PageShell({ href, title, description, kicker, stat, synced, source, children }: PageShellProps) {
  const found = findNavItem(href);
  // Pages outside the navigation (videos, for example) sit under Learn.
  const group = found?.group ?? NAV_GROUPS.find((g) => g.key === 'learn') ?? NAV_GROUPS[0];
  const Icon = found?.item.Icon ?? group.items[0].Icon;
  const counts = getSectionCounts();

  return (
    <main className="pg">
      <nav className="pg-crumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link href={group.items[0].href}>{group.label}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{title}</span>
      </nav>
      <div className="pg-layout">
        <Sidebar group={group} active={found?.item.href ?? href} counts={counts} />
        <div className="pg-main">
          <header className="pg-head">
            <div className="pg-head-copy">
              <div className="pg-head-top">
                <span className="pg-icon"><Icon size={22} aria-hidden="true" /></span>
                <span className="pg-kicker">{kicker ?? `${group.label} · ${title}`.toUpperCase()}</span>
              </div>
              <h1 className="pg-h1">{title}</h1>
              <p className="pg-desc">{description}</p>
            </div>
            {(stat || synced) && (
              <div className="pg-stats">
                {stat && (
                  <div className="pg-stat">
                    <b>{typeof stat.value === 'number' ? stat.value.toLocaleString('en-US') : stat.value}</b>
                    <span>{stat.unit}</span>
                  </div>
                )}
                {synced && (
                  <div className="pg-stat pg-stat--sync">
                    <span className="pg-sync-line">
                      <span className="dp-ping" aria-hidden="true"><span className="dp-ping-ring" /><span className="dp-ping-core" /></span>
                      synced {ago(synced)}
                    </span>
                    {source && <span className="pg-stat-src">{source}</span>}
                  </div>
                )}
              </div>
            )}
          </header>
          {children}
        </div>
      </div>
    </main>
  );
}

export function PgList({ children, empty }: { children: ReactNode; empty?: ReactNode }) {
  return <div className="pg-list">{children}{empty}</div>;
}

export function PgRow({
  href, tag, tone = 'mute', meta, title, sub, date, delay = 0, external = false,
}: {
  href: string;
  tag?: string;
  tone?: Tone;
  meta?: string;
  title: ReactNode;
  sub?: ReactNode;
  date?: string;
  delay?: number;
  external?: boolean;
}) {
  const body = (
    <>
      <div className="pg-row-main">
        {(tag || meta) && (
          <div className="pg-row-top">
            {tag && <span className="pg-tag" data-tone={tone}>{tag}</span>}
            {meta && <span className="pg-row-meta">{meta}</span>}
          </div>
        )}
        <div className="pg-row-title">{title}</div>
        {sub && <div className="pg-row-sub">{sub}</div>}
      </div>
      <div className="pg-row-end">
        {date && <span className="pg-row-date">{date}</span>}
        <span className="pg-row-go" aria-hidden="true">{external ? '↗' : '→'}</span>
      </div>
    </>
  );
  const style = { animationDelay: `${delay}ms` };
  return external ? (
    <a href={href} className="pg-row" style={style} target="_blank" rel="noopener noreferrer">{body}</a>
  ) : (
    <Link href={href} className="pg-row" style={style}>{body}</Link>
  );
}

export function PgFoot({ shown, total, children }: { shown: number; total: number; children?: ReactNode }) {
  return (
    <div className="pg-foot">
      <span>Showing {shown.toLocaleString('en-US')} of {total.toLocaleString('en-US')}</span>
      {children ?? <Link href="/search">Search all sources →</Link>}
    </div>
  );
}
