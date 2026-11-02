import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { SITE as SITE_CONFIG } from '@/lib/site.config';
import { getBlogPosts } from '@/lib/blog';

const SITE = SITE_CONFIG.url;
const TITLE = SITE_CONFIG.name;

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface FeedEntry { id: string; title: string; link: string; updated: string; summary: string }

function atom(entries: FeedEntry[], feedId: string, feedTitle: string) {
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

function getPulseEntries() {
  const db = getDb();
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
  const forum = db.prepare(`SELECT 'forum' as src, CAST(id AS TEXT) as id, title as t, last_post_at as at FROM forum_topics WHERE last_post_at > ? ORDER BY last_post_at DESC LIMIT 40`).all(cutoff) as Array<{ src: string; id: string; t: string | null; at: string }>;
  return forum.map(r => ({
    id: `${SITE}/pulse#${r.src}-${r.id}`,
    title: r.t ?? '(no title)',
    link: `${SITE}/discussions/${r.id}`,
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

  let entries: FeedEntry[];
  let feedTitle: string;

  switch (source) {
    case 'forum':
      entries = getForumEntries();
      feedTitle = 'Discussions';
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
