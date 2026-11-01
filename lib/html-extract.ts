// Shared HTML→text helpers for the doc-crawling sync scripts.
// The defining feature is htmlToTextWithCode(): it preserves <pre> code blocks
// as fenced ``` blocks (with newlines intact) instead of collapsing all
// whitespace. That matters because the crawled partner docs carry SDK usage
// and code examples - flattening them would make the code useless in RAG.
//
// Shared HTML-to-text extraction for the doc ingests.

export function htmlDecode(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, ' ');
}

// Convert an HTML fragment to text while keeping <pre> code blocks intact.
// Strategy: pull every <pre>...</pre> out first (inner text, newlines
// preserved, wrapped in a fenced block), drop the rest of the tags, then
// stitch the code blocks back via placeholders.
export function htmlToTextWithCode(html: string): string {
  const blocks: string[] = [];
  let work = html.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner: string) => {
    const code = htmlDecode(
      inner
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(div|p|li)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
    ).replace(/\n{3,}/g, '\n\n').trimEnd();
    const idx = blocks.length;
    blocks.push('\n```\n' + code + '\n```\n');
    return ` CODE${idx} `;
  });

  work = work
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ');

  work = work.replace(/<\/?code\b[^>]*>/gi, '`');
  work = htmlDecode(work.replace(/<[^>]+>/g, ' '));
  work = work.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  work = work.replace(/ CODE(\d+) /g, (_, i) => blocks[parseInt(i, 10)] ?? '');
  return work.replace(/``+/g, '`').trim();
}

// Pull the meaningful content container out of a full HTML page, dropping
// nav/footer/script/style noise. Falls back <main> → <article> → <body>.
export function extractMain(html: string): string | null {
  const m =
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ??
    null;
  if (!m) return null;
  return m.replace(/<(script|style|nav|footer|form|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
}

export function extractTitle(html: string): string {
  const og = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1];
  if (og) return htmlDecode(og).trim();
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  return t ? htmlDecode(t).trim() : 'Untitled';
}

// Real HTML tag names (structural/markup) - as opposed to legitimate angle-
// bracket text like <MIGRATION_ID> or <new_participant_id> in code/docs.
// node-html-parser's .text leaks syntax-highlighter <span class="…"> markup out
// of <pre> code blocks; stripping by an allowlist removes that markup WITHOUT
// eating placeholders (which is what a blanket /<[^>]+>/ would do).
const HTML_TAG_RE = /<\/?(?:span|code|pre|div|p|a|button|em|strong|i|b|u|s|small|sub|sup|ul|ol|li|dl|dt|dd|table|thead|tbody|tfoot|tr|td|th|caption|colgroup|col|h[1-6]|br|hr|img|nav|section|header|footer|aside|main|article|figure|figcaption|blockquote|kbd|samp|var|mark|abbr|cite|q|details|summary|label|input|form|select|option|textarea|iframe|video|audio|source|svg|path|g|rect|circle|line|wbr)\b[^>]*>/gi;

// Strip leaked HTML markup tags from already-extracted text, preserving any
// <PLACEHOLDER>-style tokens that aren't real HTML elements. Collapses the
// whitespace the removed tags leave behind.
export function stripHtmlTags(text: string): string {
  return text.replace(HTML_TAG_RE, ' ').replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').trim();
}

export function discoverFromSitemap(xml: string, filter?: RegExp): string[] {
  const urls = (xml.match(/<loc>([^<]+)<\/loc>/g) ?? []).map((m) => m.replace(/<\/?loc>/g, '').trim());
  return filter ? urls.filter((u) => filter.test(u)) : urls;
}
