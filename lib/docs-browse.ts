import type { DocSort, DocSourceCount } from './docs';

export type DocKind = 'official' | 'ecosystem' | 'code';

export const DOC_PER_PAGE = 30;
export const MAIN_SOURCE_MIN_PAGES = 20;

export const OFFICIAL_DOC_SOURCES = ['docs', 'nomicon'] as const;
export const CODE_DOC_SOURCES = ['github-code', 'npm-package'] as const;

export const DOC_KINDS: readonly { key: DocKind; label: string; hint: string }[] = [
  { key: 'official', label: 'Official', hint: 'documentation published by the network itself and its foundation' },
  { key: 'ecosystem', label: 'Ecosystem', hint: 'documentation published by teams building on the network' },
  { key: 'code', label: 'Code', hint: 'readmes and files from GitHub repositories and npm packages' },
];

export const DOC_SEARCH_SUGGESTIONS = ['validator', 'governance', 'token', 'upgrade'] as const;

export function docSourceKind(source: string): DocKind {
  if ((OFFICIAL_DOC_SOURCES as readonly string[]).includes(source)) return 'official';
  if ((CODE_DOC_SOURCES as readonly string[]).includes(source)) return 'code';
  return 'ecosystem';
}

export function parseDocKind(value: string | undefined): DocKind | null {
  return DOC_KINDS.some(k => k.key === value) ? (value as DocKind) : null;
}

export function kindSources(kind: DocKind | null): { include?: readonly string[]; exclude?: readonly string[] } | undefined {
  if (kind === 'official') return { include: OFFICIAL_DOC_SOURCES };
  if (kind === 'code') return { include: CODE_DOC_SOURCES };
  if (kind === 'ecosystem') return { exclude: [...OFFICIAL_DOC_SOURCES, ...CODE_DOC_SOURCES] };
  return undefined;
}

export function docSortsFor(hasQuery: boolean): readonly { key: DocSort; label: string }[] {
  return hasQuery
    ? [{ key: 'relevance', label: 'Best match' }, { key: 'updated', label: 'Recently updated' }]
    : [{ key: 'updated', label: 'Recently updated' }, { key: 'title', label: 'A to Z' }];
}

export function parseDocSort(value: string | undefined, hasQuery: boolean): DocSort {
  const allowed = docSortsFor(hasQuery);
  return allowed.find(s => s.key === value)?.key ?? allowed[0].key;
}

export function kindCounts(sources: readonly DocSourceCount[]): Record<DocKind, number> {
  const out: Record<DocKind, number> = { official: 0, ecosystem: 0, code: 0 };
  for (const s of sources) out[docSourceKind(s.source)] += s.count;
  return out;
}

export function splitSources(sources: readonly DocSourceCount[], current?: string): { main: DocSourceCount[]; more: DocSourceCount[] } {
  const main = sources.filter(s => s.count >= MAIN_SOURCE_MIN_PAGES || s.source === current);
  const more = sources.filter(s => !main.includes(s));
  return { main, more };
}

const TRAIL_SPLIT = /\s*[›>»]\s*/;
const TRAIL_KEEP = 3;

function sameWords(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\bdocs?\b|documentation/g, '').replace(/[^a-z0-9]+/g, '');
  return norm(a) !== '' && norm(a) === norm(b);
}

export function docTrail(breadcrumb: string | null | undefined, sourceLabel: string, title: string | null | undefined): string[] {
  if (!breadcrumb) return [];
  const parts = breadcrumb
    .split(TRAIL_SPLIT)
    .map(p => p.trim())
    .filter(Boolean)
    .filter(p => !sameWords(p, sourceLabel))
    .filter((p, i, all) => !(i === all.length - 1 && title && sameWords(p, title)));
  return parts.length > TRAIL_KEEP ? ['…', ...parts.slice(-TRAIL_KEEP)] : parts;
}

export function docPageWindow(page: number, shown: number, total: number): { from: number; to: number } {
  if (shown <= 0 || total <= 0) return { from: 0, to: 0 };
  const from = (page - 1) * DOC_PER_PAGE + 1;
  return { from, to: Math.min(from + shown - 1, total) };
}

export function docPageNumbers(page: number, totalPages: number): (number | null)[] {
  const keep = new Set([1, totalPages, page - 1, page, page + 1].filter(p => p >= 1 && p <= totalPages));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push(null);
    out.push(p);
  });
  return out;
}

const HTML_TAG_NAMES = 'a|abbr|article|aside|b|blockquote|br|button|caption|code|col|colgroup|dd|del|details|div|dl|dt|em|figcaption|figure|footer|h[1-6]|header|hr|i|img|input|kbd|label|li|mark|nav|ol|p|path|pre|section|small|source|span|strong|sub|summary|sup|svg|table|tbody|td|tfoot|th|thead|tr|u|ul|video';
const HTML_TAG = new RegExp(`<\\/?(?:${HTML_TAG_NAMES})\\b[^<>]*>`, 'gi');
const HTML_TAG_CUT_AT_END = new RegExp(`<\\/?(?:${HTML_TAG_NAMES})\\b[^<>]*$`, 'i');

export function cleanDocText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(HTML_TAG, ' ')
    .replace(HTML_TAG_CUT_AT_END, ' ')
    .replace(/^\s*[\w:-]+\s*=\s*"[^"<>]*"[^<>]*>/, ' ')
    .replace(/!\[[^\]]*\]\([^)\s]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
    .replace(/```[\w-]*|`/g, '')
    .replace(/(^|[\s(])(\*\*|__)(?=\S)([^*_]*?\S)\2(?=[\s),;:!?]|\.(?:\s|$)|$)/g, '$1$3')
    .replace(/(^|\s)#{1,6}(?=\s)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function outsideUrls(text: string, start: number, end: number): [number, number] {
  for (const m of text.matchAll(/https?:\/\/\S+/g)) {
    const a = m.index ?? 0;
    const b = a + m[0].length;
    if (start > a && start < b) start = b;
    if (end > a && end < b) end = a;
    if (end <= start) end = Math.max(end, b);
  }
  return [start, Math.max(start, end)];
}

export function snippet(text: string | null | undefined, query: string, max = 200): string {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  const words = query.trim().split(/\s+/).map(w => w.replace(/^"+|"+$/g, '')).filter(w => w.length >= 2);
  const head = () => {
    if (clean.length <= max) return clean;
    const [start, end] = outsideUrls(clean, 0, max);
    return clean.slice(start, end) + '…';
  };
  if (words.length === 0) return head();
  const re = new RegExp(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
  const idx = clean.search(re);
  if (idx === -1) return head();
  const [start, end] = outsideUrls(clean, Math.max(0, idx - 60), Math.min(clean.length, idx + max - 60));
  const result = clean.slice(start, end);
  return (start > 0 ? '…' : '') + result + (end < clean.length ? '…' : '');
}
