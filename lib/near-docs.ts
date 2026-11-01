/**
 * docs.near.org ships the whole site as one Mintlify llms-full.txt. Each page
 * opens with a two-line header and runs to the next one:
 *
 *   # <page title>
 *   Source: https://docs.near.org/<path>
 *
 * The title may be empty: the home page's header is a bare `# ` (2026-11-01),
 * and a title-required pattern dropped exactly that one page out of 198.
 *
 * Partner sites on Mintlify (NEAR Intents, Trezu) ship the same format under
 * their own origin, so the parser takes the origin whose pages it reads.
 */

import { createHash } from 'node:crypto';

export const DOCS_ORIGIN = 'https://docs.near.org';
export const LLMS_URL = `${DOCS_ORIGIN}/llms-full.txt`;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

export function headerRe(origin: string): RegExp {
  return new RegExp(`^# (.*)\\nSource: (${escapeRe(origin)}\\/\\S*)$`, 'gm');
}

export const HEADER_RE = headerRe(DOCS_ORIGIN);

export interface NearDocPage {
  url: string;
  title: string;
  breadcrumb: string | null;
  excerpt: string | null;
  content_text: string;
  content_hash: string;
}

export function canonicalDocUrl(raw: string): string {
  return raw.trim().replace(/\.md$/i, '').replace(/\/+$/, '');
}

export function breadcrumbFromUrl(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const segments = pathname.split('/').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/[-_]/g, ' '));
  return segments.length ? segments.join(' › ') : null;
}

function titleFromUrl(url: string): string {
  const last = new URL(url).pathname.split('/').filter(Boolean).pop();
  if (!last || last === 'index') return url.startsWith(DOCS_ORIGIN) ? 'NEAR Docs' : new URL(url).hostname;
  return last.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function excerptOf(markdown: string): string | null {
  const plain = markdown
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.slice(0, 200) || null;
}

export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export function parseLlmsFull(text: string, origin: string = DOCS_ORIGIN): NearDocPage[] {
  const re = headerRe(origin);
  const headers: { title: string; url: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    headers.push({ title: m[1].trim(), url: m[2], start: m.index, end: re.lastIndex });
  }

  const pages: NearDocPage[] = [];
  const seen = new Set<string>();
  headers.forEach((h, i) => {
    const contentEnd = i + 1 < headers.length ? headers[i + 1].start : text.length;
    const content_text = text.slice(h.end, contentEnd)
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .trim();
    const url = canonicalDocUrl(h.url);
    if (!content_text || seen.has(url)) return;
    seen.add(url);
    pages.push({
      url,
      title: h.title || titleFromUrl(url),
      breadcrumb: breadcrumbFromUrl(url),
      excerpt: excerptOf(content_text),
      content_text,
      content_hash: contentHash(content_text),
    });
  });
  return pages;
}

/** Every page URL llms-full.txt announces, including any with an empty body. */
export function announcedUrls(text: string, origin: string = DOCS_ORIGIN): string[] {
  return [...new Set([...text.matchAll(headerRe(origin))].map((m) => canonicalDocUrl(m[2])))];
}

export type DocChange = { url: string; title: string; kind: 'doc_added' | 'doc_changed' };

/**
 * Pages added or rewritten between the stored set and a fresh parse. A first
 * run (no stored pages) reports nothing: the whole corpus arriving at once is
 * not news, and recording 198 "added" events would bury the real ones.
 *
 * Removals are not reported here. A page missing from the parse may only have
 * rendered empty for one build, so removal is decided by the sync's prune
 * against every URL the feed announces, with a 404 probe, and recorded there.
 */
export function diffPages(
  stored: ReadonlyArray<{ url: string; title: string | null; content_hash: string | null }>,
  fresh: ReadonlyArray<NearDocPage>,
): DocChange[] {
  if (stored.length === 0) return [];
  const before = new Map(stored.map((p) => [p.url, p]));
  const changes: DocChange[] = [];
  for (const p of fresh) {
    const old = before.get(p.url);
    if (!old) changes.push({ url: p.url, title: p.title, kind: 'doc_added' });
    else if (old.content_hash && old.content_hash !== p.content_hash) changes.push({ url: p.url, title: p.title, kind: 'doc_changed' });
  }
  return changes;
}
