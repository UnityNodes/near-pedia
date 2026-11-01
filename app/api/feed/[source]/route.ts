import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { SITE as SITE_CONFIG } from '@/lib/site.config';
import { getBlogPosts } from '@/lib/blog';

const SITE = SITE_CONFIG.url;
const TITLE = SITE_CONFIG.name;

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function atom(entries: { id: string; title: string; link: string; updated: string; summary: string }[], feedId: string, feedTitle: string) {
  const updated = entries[0]?.updated ?? new Date().toISOString();
  const items = entries.map(e => `
  <entry>
    <id>${esc(e.id)}</id>
    <title>${esc(e.title)}</title>
    <link href="${esc(e.link)}" />
    <updated>${e.updated}</updated>
    <summary>${esc(e.summary)}</summary>
  </entry>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${esc(`${SITE}/api/feed/${feedId}`)}</id>
  <title>${esc(`${TITLE} · ${feedTitle}`)}</title>
  <link href="${esc(SITE)}" />
  <link rel="self" href="${esc(`${SITE}/api/feed/${feedId}`)}" />
  <updated>${updated}</updated>
${items}
</feed>`;
}

function getCipsEntries() {
  const db = getDb();
  const rows = db.prepare(`SELECT id, cip_number, title, status, synced_at FROM cips ORDER BY cip_number DESC LIMIT 40`).all() as
    Array<{ id: string; cip_number: number | null; title: string | null; status: string | null; synced_at: string }>;
  return rows.map(r => ({
    id: `${SITE}/cips/${r.id}`,
    title: `CIP-${String(r.cip_number ?? r.id).padStart(4, '0')}: ${r.title ?? 'Untitled'}`,
    link: `${SITE}/cips/${r.id}`,
    updated: r.synced_at,
    summary: r.status ?? '',
  }));
}

function getForumEntries() {
  const db = getDb();
  const rows = db.prepare(`SELECT id, title, last_post_at FROM forum_topics ORDER BY last_post_at DESC LIMIT 40`).all() as
    Array<{ id: number; title: string | null; last_post_at: string | null }>;
  return rows.filter(r => r.last_post_at).map(r => ({
    id: `${SITE}/discussions/${r.id}`,
    title: r.title ?? '(no title)',
    link: `${SITE}/discussions/${r.id}`,
    updated: r.last_post_at!,
    summary: '',
  }));
}

function getChangesEntries() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT h.id, h.cip_id, c.cip_number, c.title, h.from_status, h.to_status, h.changed_at
    FROM cip_status_history h LEFT JOIN cips c ON c.id = h.cip_id
    ORDER BY h.changed_at DESC LIMIT 40
  `).all() as Array<{ id: number; cip_id: string; cip_number: number | null; title: string | null; from_status: string | null; to_status: string; changed_at: string }>;
  return rows.map(r => ({
    id: `${SITE}/changes#${r.id}`,
    title: `CIP-${String(r.cip_number ?? r.cip_id).padStart(4, '0')} ${r.from_status ?? '-'} → ${r.to_status}`,
    link: `${SITE}/cips/${r.cip_id}`,
    updated: r.changed_at,
    summary: r.title ?? '',
  }));
}

function getPulseEntries() {
  const db = getDb();
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
  // synced_at is touched on every sync run regardless of whether the CIP
  // actually changed, so filtering/sorting by it answered "recently
  // re-synced", not "recently arrived" - it could surface every CIP after a
  // full resync as if it were fresh activity. cip_status_history records one
  // row with from_status IS NULL per CIP the first time it's seen, which is
  // when it was actually first indexed (same fix as mcp-server.ts's
  // /api/v1/changes newCips and scripts/build-weekly-digest.ts).
  const cips = db.prepare(`
    SELECT 'cip' as src, c.id, c.title as t, MIN(h.changed_at) as at
    FROM cips c JOIN cip_status_history h ON h.cip_id = c.id
    WHERE h.from_status IS NULL
    GROUP BY c.id
    HAVING at > ?
    ORDER BY at DESC LIMIT 10
  `).all(cutoff) as Array<{ src: string; id: string; t: string | null; at: string }>;
  const forum = db.prepare(`SELECT 'forum' as src, CAST(id AS TEXT) as id, title as t, last_post_at as at FROM forum_topics WHERE last_post_at > ? ORDER BY last_post_at DESC LIMIT 20`).all(cutoff) as Array<{ src: string; id: string; t: string | null; at: string }>;
  const all = [...cips, ...forum].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
  return all.map(r => ({
    id: `${SITE}/pulse#${r.src}-${r.id}`,
    title: r.t ?? '(no title)',
    link: r.src === 'cip' ? `${SITE}/cips/${r.id}` : `${SITE}/discussions/${r.id}`,
    updated: r.at,
    summary: r.src.toUpperCase(),
  }));
}

function getBlogEntries() {
  try {
    return getBlogPosts({ perPage: 40 }).posts
      .filter(p => p.published_at)
      .map(p => ({
        id: `${SITE}/blog/${p.id}`,
        title: p.title,
        link: `${SITE}/blog/${p.id}`,
        updated: p.published_at as string,
        summary: p.line,
      }));
  } catch { return []; }
}

function getReleaseEntries() {
  const db = getDb();
  try {
    const rows = db.prepare(`SELECT id, repo, tag, name, body, published_at, url FROM github_releases WHERE published_at IS NOT NULL ORDER BY published_at DESC LIMIT 40`).all() as
      Array<{ id: string; repo: string; tag: string; name: string | null; body: string | null; published_at: string; url: string }>;
    return rows.map(r => ({
      id: r.url,
      title: `${r.repo}: ${r.name ?? r.tag}`,
      link: r.url,
      updated: r.published_at,
      summary: (r.body ?? '').replace(/[#*`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 280),
    }));
  } catch { return []; }
}

function getDiscussionEntries() {
  const db = getDb();
  try {
    const rows = db.prepare(`SELECT id, repo, title, body, url, category, created_at FROM github_discussions WHERE created_at IS NOT NULL ORDER BY created_at DESC LIMIT 40`).all() as
      Array<{ id: string; repo: string; title: string; body: string | null; url: string; category: string | null; created_at: string }>;
    return rows.map(r => ({
      id: r.url,
      title: `${r.repo} · ${r.title}`,
      link: r.url,
      updated: r.created_at,
      summary: [r.category, (r.body ?? '').replace(/[#*`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 240)].filter(Boolean).join(' · '),
    }));
  } catch { return []; }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ source: string }> },
) {
  const { source } = await params;

  let entries: ReturnType<typeof getCipsEntries>;
  let feedTitle: string;

  switch (source) {
    case 'cips':
      entries = getCipsEntries();
      feedTitle = 'CIPs';
      break;
    case 'forum':
      entries = getForumEntries();
      feedTitle = 'Discussions';
      break;
    case 'changes':
      entries = getChangesEntries();
      feedTitle = 'CIP Changes';
      break;
    case 'pulse':
      entries = getPulseEntries();
      feedTitle = 'Pulse';
      break;
    case 'blog':
      entries = getBlogEntries();
      feedTitle = 'Blog & News';
      break;
    case 'releases':
      entries = getReleaseEntries();
      feedTitle = 'GitHub Releases';
      break;
    case 'github-discussions':
      entries = getDiscussionEntries();
      feedTitle = 'GitHub Discussions';
      break;
    default:
      return new Response('Not found', { status: 404 });
  }

  const xml = atom(entries, source, feedTitle);
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
    },
  });
}
