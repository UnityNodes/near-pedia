'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, Boxes, CirclePlay, FileText, GitBranch, GitPullRequest, BookOpen, MessageCircle,
  MessagesSquare, Package, PenLine, Plug, Radar, ScrollText, Tag, Zap,
  type LucideIcon,
} from 'lucide-react';

type GroupKey = 'code' | 'learn' | 'governance' | 'ecosystem';

const GROUPS: { key: GroupKey; name: string }[] = [
  { key: 'code', name: 'Code' },
  { key: 'learn', name: 'Docs' },
  { key: 'governance', name: 'Governance' },
  { key: 'ecosystem', name: 'Ecosystem' },
];

const TYPE_MAP: Record<string, { name: string; Icon: LucideIcon; group: GroupKey; href: string }> = {
  package:           { name: 'npm + crates.io', Icon: Package,      group: 'code',       href: '/deprecations?kind=package' },
  github_repo:       { name: 'Repositories', Icon: GitBranch,      group: 'code',       href: '/deprecations?kind=repo' },
  github_release:    { name: 'Releases',     Icon: Tag,            group: 'code',       href: '/releases' },
  github_item:       { name: 'GitHub issues', Icon: GitPullRequest, group: 'code',      href: '/code' },
  doc:               { name: 'Docs',         Icon: BookOpen,       group: 'learn',      href: '/docs' },
  blog_post:         { name: 'Blog',         Icon: PenLine,        group: 'learn',      href: '/blog' },
  youtube_video:     { name: 'Videos',       Icon: CirclePlay,     group: 'learn',      href: '/videos' },
  nep_standard:      { name: 'NEPs',         Icon: ScrollText,     group: 'learn',      href: '/docs' },
  hos_proposal:      { name: 'House of Stake', Icon: FileText,     group: 'governance', href: '/governance' },
  forum_topic:       { name: 'gov.near.org', Icon: MessagesSquare, group: 'governance', href: '/discussions' },
  github_discussion: { name: 'Discussions',  Icon: MessageCircle,  group: 'governance', href: '/discussions' },
  ecosystem_project: { name: 'NEAR Catalog', Icon: Boxes,          group: 'ecosystem',  href: '/ecosystem' },
  incident:          { name: 'Incidents',    Icon: Zap,            group: 'ecosystem',  href: '/radar' },
  radar_item:        { name: 'Radar',        Icon: Radar,          group: 'ecosystem',  href: '/radar' },
};

const DAY_MS = 86_400_000;
const COUNT_UP_MS = 1400;

interface SourcesResponse {
  total_records: number;
  source_count: number;
  mcp_tools_count: number;
  avg_latency_ms: number | null;
  sources: { type: string; desc: string; count: number; last_synced: string | null }[];
}

interface NormalizedSource {
  type: string;
  name: string;
  Icon: LucideIcon;
  group: GroupKey;
  href: string;
  count: number;
  lastSynced: string | null;
}

type Mode = 'live' | 'server' | 'unavailable';

interface Props {
  refreshInterval?: number;
  endpoint?: string;
  initial?: SourcesResponse | null;
  stickers?: boolean;
}

const EMPTY: SourcesResponse = {
  total_records: 0,
  source_count: 0,
  mcp_tools_count: 0,
  avg_latency_ms: null,
  sources: [],
};

function normalize(data: SourcesResponse): NormalizedSource[] {
  return data.sources
    .filter((s) => TYPE_MAP[s.type])
    .map((s) => ({ type: s.type, ...TYPE_MAP[s.type], count: s.count, lastSynced: s.last_synced }));
}

function countSyncedWithin(sources: NormalizedSource[], windowMs: number): number {
  const now = Date.now();
  return sources.filter((s) => s.lastSynced && now - new Date(s.lastSynced).getTime() < windowMs).length;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function useCountUp(target: number): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      fromRef.current = target;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the displayed number follows the target
      setValue(target);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / COUNT_UP_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = from + (target - from) * eased;
      fromRef.current = next;
      setValue(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return value;
}

function PingDot() {
  return (
    <span className="dp-ping" aria-hidden="true">
      <span className="dp-ping-ring" />
      <span className="dp-ping-core" />
    </span>
  );
}

function ModePill({ mode }: { mode: Mode }) {
  if (mode === 'unavailable') return <span className="kp-pill kp-pill--off">● OFFLINE</span>;
  return <span className="kp-pill">{mode === 'live' ? '● LIVE' : '● SERVER'}</span>;
}

export function SourcesLive({
  refreshInterval = 60_000,
  endpoint = '/api/v1/sources',
  initial = null,
  stickers = false,
}: Props = {}) {
  const [data, setData] = useState<SourcesResponse>(initial ?? EMPTY);
  const [mode, setMode] = useState<Mode>(initial ? 'server' : 'unavailable');
  const [group, setGroup] = useState<GroupKey>('code');
  const [userPicked, setUserPicked] = useState(false);

  const sources = normalize(data);
  const totals = Object.fromEntries(
    GROUPS.map((g) => [g.key, sources.filter((s) => s.group === g.key).reduce((sum, s) => sum + s.count, 0)]),
  ) as Record<GroupKey, number>;
  const visibleGroups = GROUPS.filter((g) => sources.some((s) => s.group === g.key));
  const activeGroup = visibleGroups.some((g) => g.key === group) ? group : (visibleGroups[0]?.key ?? 'code');
  const rows = sources.filter((s) => s.group === activeGroup).sort((a, b) => b.count - a.count);
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  const total = sources.reduce((sum, s) => sum + s.count, 0);
  const syncedToday = countSyncedWithin(sources, DAY_MS);

  const shownTotal = useCountUp(total);
  const shownTab = useCountUp(totals[activeGroup] ?? 0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(endpoint, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as SourcesResponse;
        if (cancelled) return;
        setData(json);
        setMode('live');
      } catch {
        if (cancelled) return;
        setMode(initial ? 'server' : 'unavailable');
      }
    };
    load();
    if (refreshInterval > 0) {
      const id = setInterval(load, refreshInterval);
      return () => { cancelled = true; clearInterval(id); };
    }
    return () => { cancelled = true; };
  }, [refreshInterval, endpoint, initial]);

  const visibleKeys = visibleGroups.map((g) => g.key).join('|');

  useEffect(() => {
    const keys = visibleKeys ? visibleKeys.split('|') : [];
    if (userPicked || keys.length < 2) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const id = setInterval(() => {
      setGroup((cur) => keys[(keys.indexOf(cur) + 1) % keys.length] as GroupKey);
    }, 6000);
    return () => clearInterval(id);
  }, [userPicked, visibleKeys]);

  const sourceCount = data.source_count || sources.length;

  return (
    <div className="kp-wrap">
      {stickers && (
        <>
          <div className="kp-sticker kp-sticker--ok" aria-hidden="true">
            <span className="kp-sticker-dot" />{syncedToday} synced today
          </div>
          <Link href="/for-ai" className="kp-sticker kp-sticker--cy">
            <Plug size={14} aria-hidden="true" />MCP · no key
          </Link>
          <a href="/api/v1/reference" className="kp-sticker kp-sticker--acc">
            <Zap size={14} aria-hidden="true" />REST API · open
          </a>
        </>
      )}
      <div className="kp">
        <div className="kp-head">
          <div>
            <div className="kp-title">Knowledge layer</div>
            <div className="kp-sub">{sourceCount} SOURCES · SYNCING</div>
          </div>
          <div className="kp-stats">
            <span>
              <b>{data.mcp_tools_count > 0 ? data.mcp_tools_count : '-'}</b>
              <span>MCP TOOLS</span>
            </span>
            <span>
              <b>{data.avg_latency_ms != null ? `${data.avg_latency_ms}ms` : '-'}</b>
              <span>AVG LATENCY</span>
            </span>
            <ModePill mode={mode} />
          </div>
        </div>

        {mode === 'unavailable' ? (
          <div className="kp-empty">Counts are unavailable right now. Nothing here is a placeholder.</div>
        ) : (
          <>
            <div className="kp-tabs" role="tablist" style={{ gridTemplateColumns: `repeat(${Math.max(1, visibleGroups.length)}, minmax(0, 1fr))` }}>
              {visibleGroups.map((g) => {
                const active = g.key === activeGroup;
                return (
                  <button
                    key={g.key}
                    role="tab"
                    aria-selected={active}
                    className={`kp-tab${active ? ' kp-tab--on' : ''}`}
                    onClick={() => { setGroup(g.key); setUserPicked(true); }}
                  >
                    <span className="kp-tab-name">{active && <PingDot />}{g.name}</span>
                    <b>{fmt(active ? shownTab : totals[g.key])}</b>
                  </button>
                );
              })}
            </div>

            <div className="kp-rows" key={activeGroup}>
              {rows.map((r, i) => (
                <Link key={r.type} href={r.href} className="kp-row" style={{ animationDelay: `${i * 45}ms` }}>
                  <span className="kp-row-name"><r.Icon size={15} aria-hidden="true" />{r.name}</span>
                  <span className="kp-bar"><span style={{ width: `${Math.max(2, (r.count / maxCount) * 100)}%` }} /></span>
                  <span className="kp-row-n">{fmt(r.count)}</span>
                  <ArrowRight size={13} className="kp-row-go" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </>
        )}

        <div className="kp-total">
          <div className="kp-total-label">
            TOTAL INDEXED RECORDS<br />{sources.length} of {sourceCount} sources · full-text search
          </div>
          <div className="kp-total-n">
            <b>{fmt(shownTotal)}</b>
            <span>records</span>
          </div>
        </div>

        <div className="kp-foot">
          <span>{sourceCount} sources</span>
          <span>5 min – 24 h sync</span>
          <a href="/api/v1/sources">/api/v1/sources</a>
          <span className="kp-foot-end">Free, no API key</span>
        </div>
      </div>
    </div>
  );
}
