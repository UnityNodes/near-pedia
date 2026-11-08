import type { SourceEntry } from '@/lib/sources';

interface SourceMeta {
  name: string;
  href: string | null;
  script: string;
}

export const SOURCE_META: Record<string, SourceMeta> = {
  doc:               { name: 'Docs',         href: '/docs',        script: 'sync-docs' },
  blog_post:         { name: 'Blog',         href: '/blog',        script: 'sync-blog' },
  forum_topic:       { name: 'Forum',        href: '/discussions', script: 'sync-forum' },
  youtube_video:     { name: 'Videos',       href: '/videos',      script: 'sync-youtube' },
  github_item:       { name: 'GitHub items', href: '/code',        script: 'sync-github-items' },
  github_release:    { name: 'Releases',     href: '/releases',    script: 'sync-github-releases' },
  github_discussion: { name: 'Discussions',  href: '/discussions', script: 'sync-github-discussions' },
  ecosystem_project: { name: 'Ecosystem',    href: '/ecosystem',   script: 'sync-ecosystem' },
  package:           { name: 'npm + crates.io packages', href: null, script: 'sync-packages' },
  github_repo:       { name: 'GitHub repositories',      href: null, script: 'sync-repos' },
  hos_proposal:      { name: 'House of Stake proposals', href: null, script: 'sync-hos' },
  incident:          { name: 'Security incidents',       href: null, script: 'sync-incidents' },
  nep_standard:      { name: 'NEPs (NEAR standards)',    href: null, script: 'sync-neps' },
  radar_item:        { name: 'Radar items',              href: '/radar', script: 'refresh-radar' },
};

export const BUCKET_CADENCE: Record<string, string> = {
  fast: '5 min',
  medium: '15 min',
  slow: '6 h',
  daily: '24 h',
  weekly: '7 d',
};

const EXCLUDED_TYPES = new Set(['embedding_chunk']);

export interface FreshnessRow {
  type: string;
  name: string;
  href: string | null;
  records: number;
  cadence: string | null;
  lastSynced: string | null;
}

export function freshnessRows(
  sources: readonly SourceEntry[],
  schedule: ReadonlyMap<string, { bucket: string }>,
): FreshnessRow[] {
  return sources
    .filter((s) => !EXCLUDED_TYPES.has(s.type))
    .map((s) => {
      const meta = SOURCE_META[s.type];
      const bucket = meta ? schedule.get(meta.script)?.bucket : undefined;
      return {
        type: s.type,
        name: meta?.name ?? s.type,
        href: meta?.href ?? null,
        records: s.count,
        cadence: bucket ? (BUCKET_CADENCE[bucket] ?? null) : null,
        lastSynced: s.last_synced,
      };
    })
    .sort((a, b) => b.records - a.records || a.name.localeCompare(b.name));
}

export function latestSync(sources: readonly SourceEntry[]): string | null {
  let best: { iso: string; ms: number } | null = null;
  for (const s of sources) {
    if (!s.last_synced) continue;
    const ms = Date.parse(s.last_synced);
    if (Number.isFinite(ms) && (!best || ms > best.ms)) best = { iso: s.last_synced, ms };
  }
  return best ? best.iso : null;
}

export function ragChunkCount(sources: readonly SourceEntry[]): number {
  return sources.filter((s) => s.type === 'embedding_chunk').reduce((sum, s) => sum + s.count, 0);
}

export function renderClock(): number {
  return Date.now();
}

export function agoLabel(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
