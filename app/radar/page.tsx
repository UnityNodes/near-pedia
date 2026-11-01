import Link from 'next/link';
import type { ReactNode } from 'react';
import './design.css';
import { getDb } from '@/lib/db';
import { pageMetadata } from '@/lib/seo';
import { radarLiveSql } from '@/lib/constants';
import { escLike } from '@/lib/rank';
import { getLastSync } from '@/lib/section-counts';
import type { Tone } from '@/lib/status';
import { EmptyAnimation } from '@/components/resources-empty-animation';
import { PageShell, PgFoot, PgList } from '@/components/page-shell';
import { LEVEL_LABEL, LEVEL_TONE, RadarRow, SectionHead, type RadarLevel } from '@/components/monitor-parts';

export const revalidate = 300;

export const metadata = pageMetadata({
  title: 'NEAR Radar',
  description: 'Critical deadlines, breaking changes, and ecosystem updates for NEAR node operators, application developers, and validators.',
  path: '/radar',
});

interface RadarItem {
  id: number;
  level: RadarLevel;
  title: string;
  body: string | null;
  source_type: string;
  source_url: string | null;
  affects: string;
  deadline: string | null;
  published_at: string;
}

const LEVELS: readonly RadarLevel[] = ['critical', 'important', 'ecosystem'];

const SOURCE_LABEL: Record<string, string> = {
  forum_announcement: 'Forum',
  cip_change:         'CIP',
  github_release:     'Release',
  github_issue:       'GitHub',
};

const AFFECT_LABEL: Record<string, string> = {
  validator:       'Validators',
  'node-operator': 'Node Operators',
  'rollup-dev':    'App Devs',
  developer:       'Developers',
};

const ROLE_FILTERS = ['validator', 'node-operator', 'rollup-dev', 'developer'] as const;

function getItems(level?: string, role?: string, source?: string): RadarItem[] {
  const db = getDb();
  let q = `SELECT * FROM radar_items WHERE ${radarLiveSql()}`;
  const params: string[] = [];
  if (level)  { q += ` AND level = ?`; params.push(level); }
  if (role)   { q += ` AND affects LIKE ? ESCAPE '\\'`; params.push(`%"${escLike(role)}"%`); }
  if (source) { q += ` AND source_type = ?`; params.push(source); }
  q += ` ORDER BY level ASC, published_at DESC LIMIT 200`;
  return db.prepare(q).all(...params) as RadarItem[];
}

function getSources(): string[] {
  const db = getDb();
  const rows = db.prepare(`SELECT DISTINCT source_type FROM radar_items WHERE source_type IS NOT NULL ORDER BY source_type`).all() as Array<{ source_type: string }>;
  return rows.map(r => r.source_type);
}

function parseAffects(raw: string | null): string[] {
  return JSON.parse(raw || '[]');
}

function countBy(items: RadarItem[], keyFn: (i: RadarItem) => string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    for (const k of keyFn(item)) counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

interface PageProps {
  searchParams: Promise<{ level?: string; role?: string; source?: string }>;
}

function Chip({ href, on, label, n, tone }: { href: string; on: boolean; label: string; n: number; tone?: Tone }) {
  return (
    <Link href={href} className={`pg-chip${on ? ' pg-chip--on' : ''}`} aria-current={on ? 'page' : undefined}>
      {tone && <span className="rd-chip-dot" data-tone={tone} aria-hidden="true" />}
      {label}
      <span className="rd-chip-n">{n}</span>
    </Link>
  );
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rd-filter-row" role="group" aria-label={`Filter by ${label.toLowerCase()}`}>
      <span className="rd-filter-label" aria-hidden="true">{label}</span>
      <div className="pg-chips">{children}</div>
    </div>
  );
}

export default async function RadarPage({ searchParams }: PageProps) {
  const { level, role, source } = await searchParams;
  const items = getItems(level, role, source);
  const availableSources = getSources();

  const allItems = getItems();
  const totalCounts: Record<RadarLevel, number> = { critical: 0, important: 0, ecosystem: 0 };
  allItems.forEach(i => totalCounts[i.level]++);
  const roleCounts = countBy(allItems, i => parseAffects(i.affects));
  const sourceCounts = countBy(allItems, i => [i.source_type]);

  const byLevel = (l: RadarLevel) => items.filter(i => i.level === l);
  const hasFilters = Boolean(level || role || source);

  const buildUrl = (overrides: { level?: string | null; role?: string | null; source?: string | null }) => {
    const sp = new URLSearchParams();
    const l = overrides.level !== undefined ? overrides.level : level;
    const r = overrides.role !== undefined ? overrides.role : role;
    const s = overrides.source !== undefined ? overrides.source : source;
    if (l) sp.set('level', l);
    if (r) sp.set('role', r);
    if (s) sp.set('source', s);
    const qs = sp.toString();
    return `/radar${qs ? '?' + qs : ''}`;
  };

  const description = (
    <>
      {totalCounts.critical > 0 && <>{totalCounts.critical} critical, </>}
      {totalCounts.important > 0 && <>{totalCounts.important} important, </>}
      {totalCounts.ecosystem} ecosystem {totalCounts.ecosystem === 1 ? 'item' : 'items'}: breaking changes,
      deadlines, and network updates.
    </>
  );

  return (
    <PageShell
      href="/radar"
      title="Radar"
      description={description}
      stat={{ value: allItems.length, unit: allItems.length === 1 ? 'live item' : 'live items' }}
      synced={getLastSync('radar_items', 'created_at')}
      source="radar"
    >
      <div className="pg-tools rd-filters">
        <ChipRow label="Level">
          <Chip href={buildUrl({ level: null })} on={!level} label="All" n={allItems.length} />
          {LEVELS.map(l => (
            <Chip key={l} href={buildUrl({ level: l })} on={level === l} label={LEVEL_LABEL[l]} n={totalCounts[l]} tone={LEVEL_TONE[l]} />
          ))}
        </ChipRow>

        <ChipRow label="Role">
          <Chip href={buildUrl({ role: null })} on={!role} label="All" n={allItems.length} />
          {ROLE_FILTERS.filter(r => roleCounts[r] > 0).map(r => (
            <Chip key={r} href={buildUrl({ role: r })} on={role === r} label={AFFECT_LABEL[r]} n={roleCounts[r]} />
          ))}
        </ChipRow>

        {availableSources.length > 0 && (
          <ChipRow label="Source">
            <Chip href={buildUrl({ source: null })} on={!source} label="All" n={allItems.length} />
            {availableSources.map(s => (
              <Chip key={s} href={buildUrl({ source: s })} on={source === s} label={SOURCE_LABEL[s] ?? s} n={sourceCounts[s] ?? 0} />
            ))}
          </ChipRow>
        )}
      </div>

      {items.length === 0 ? (
        <PgList>
          {hasFilters ? (
            <div className="pg-empty">
              No radar items match this filter.
              <br />
              <Link href="/radar">Clear filters →</Link>
            </div>
          ) : (
            <div className="pg-empty">
              <EmptyAnimation />
              <p>No radar items right now. The radar refresh fills this page.</p>
            </div>
          )}
        </PgList>
      ) : (
        <div className="mn-stack">
          {LEVELS.map(l => {
            const group = byLevel(l);
            if (group.length === 0) return null;
            return (
              <section key={l} aria-labelledby={`rd-${l}`}>
                <SectionHead id={`rd-${l}`} label={LEVEL_LABEL[l]} count={group.length} tone={LEVEL_TONE[l]} />
                <PgList>
                  {group.map((item, i) => (
                    <RadarRow
                      key={item.id}
                      level={item.level}
                      title={item.title}
                      body={item.body}
                      href={item.source_url}
                      tags={[
                        SOURCE_LABEL[item.source_type] ?? item.source_type,
                        ...parseAffects(item.affects).map(a => AFFECT_LABEL[a] ?? a),
                      ]}
                      deadline={item.deadline}
                      published={item.published_at}
                      index={i}
                    />
                  ))}
                </PgList>
              </section>
            );
          })}
        </div>
      )}

      {allItems.length > 0 && (
        <PgFoot shown={items.length} total={allItems.length}>
          {hasFilters ? <Link href="/radar">Clear filters</Link> : undefined}
        </PgFoot>
      )}
    </PageShell>
  );
}
