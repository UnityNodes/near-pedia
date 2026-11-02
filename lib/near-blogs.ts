/**
 * The NEAR blogs: near.org/blog (NEAR Foundation, ~640 posts) and
 * near.ai/blog (NEAR AI, ~30), both server-rendered Next.js pages listed in
 * the site sitemap. The RSS feed at www.near.org/feed.xml holds only the
 * latest 50, so the sitemap is the set and each post page is read once.
 *
 * A post page carries og:title, article:published_time and og:description
 * in its head and the article inside <main>, followed in the same <main> by
 * the site's footer: community links and a list of other posts on near.org,
 * "More from NEAR AI" on near.ai. Left in, those titles were embedded with
 * every post (613 of 639 near.org posts), so a search for one post's subject
 * returned a dozen others that only link to it. articleText cuts there.
 */

import { extractMain, htmlDecode, htmlToTextWithCode } from './html-extract';

export interface BlogSource {
  id: 'near-org' | 'near-ai';
  label: string;
  sitemap: string;
  /** Post URLs, one path segment under /blog/. */
  post: RegExp;
  /** Suffix the site appends to og:title. */
  titleSuffix: RegExp;
  /** The line where the article ends and the site's footer (community links, related posts) begins. */
  footer: RegExp;
  /** Whole lines of page chrome inside the article: share buttons, back links. */
  chrome: RegExp;
}

export const BLOG_SOURCES: readonly BlogSource[] = [
  {
    id: 'near-org',
    label: 'near.org blog',
    sitemap: 'https://near.org/sitemap.xml',
    post: /^https:\/\/(?:www\.)?near\.org\/blog\/(?!category\/|page\/|tag\/)[a-z0-9-]+\/?$/,
    titleSuffix: /\s*\|\s*NEAR\s*$/,
    footer: /^[ \t]*(?:Join the community:|More posts)[ \t]*$/m,
    chrome: /^[ \t]*Share[ \t]*$/gm,
  },
  {
    id: 'near-ai',
    label: 'near.ai blog',
    sitemap: 'https://near.ai/sitemap.xml',
    post: /^https:\/\/(?:www\.)?near\.ai\/blog\/(?!category\/|page\/|tag\/)[a-z0-9-]+\/?$/,
    titleSuffix: /\s*\|\s*NEAR AI\s*$/,
    footer: /^[ \t]*More from NEAR AI[ \t]*$/m,
    chrome: /^[ \t]*← All articles[ \t]*/gm,
  },
];

/** The minimum article text worth storing: a page below it is a shell or an error page. */
const MIN_TEXT = 200;
const EXCERPT = 300;

export function postUrls(sitemapXml: string, source: BlogSource): string[] {
  const urls = (sitemapXml.match(/<loc>([^<]+)<\/loc>/g) ?? []).map((m) => m.replace(/<\/?loc>/g, '').trim());
  return [...new Set(urls.filter((u) => source.post.test(u)).map((u) => u.replace(/\/$/, '')))];
}

export interface BlogPost {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  content_text: string;
  published_at: string | null;
  author: string;
  tags: string;
}

const meta = (html: string, prop: string): string | null => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i');
  const m = re.exec(html)?.[1];
  return m ? htmlDecode(m).trim() : null;
};

/** The article alone: cut at the site footer, page chrome lines dropped, blank runs collapsed. */
export function articleText(text: string, source: BlogSource): string {
  const end = source.footer.exec(text);
  const body = end ? text.slice(0, end.index) : text;
  return body.replace(source.chrome, '').replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n').trim();
}

export function parsePost(html: string, url: string, source: BlogSource): BlogPost | null {
  const main = extractMain(html);
  if (!main) return null;
  const content_text = articleText(htmlToTextWithCode(main), source);
  if (content_text.length < MIN_TEXT) return null;
  const slug = url.replace(/\/$/, '').split('/').pop()!;
  const title = (meta(html, 'og:title') ?? slug).replace(source.titleSuffix, '').trim();
  const published = meta(html, 'article:published_time') ?? /"datePublished":"([^"]+)"/.exec(html)?.[1] ?? null;
  const excerpt = (meta(html, 'og:description') ?? content_text).slice(0, EXCERPT);
  return {
    id: `${source.id}:${slug}`,
    url,
    title,
    excerpt,
    content_text,
    published_at: published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : null,
    author: source.id === 'near-ai' ? 'NEAR AI' : 'NEAR',
    tags: source.label,
  };
}
