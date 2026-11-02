/**
 * Documentation sites read page by page from their sitemap, for sources that
 * ship no llms-full.txt: the Nomicon, NEAR's protocol specification (97
 * pages on 2026-11-02, mdBook). Each page's <main> is the text.
 */

import { extractMain, extractTitle, htmlToTextWithCode } from './html-extract';
import { singleDocPage, type NearDocPage } from './near-docs';

export interface SiteDocs {
  /** doc_pages.source for this site's rows. */
  source: string;
  label: string;
  sitemap: string;
  origin: string;
  include: RegExp;
  titleSuffix: RegExp;
}

export const SITE_DOCS: readonly SiteDocs[] = [
  {
    source: 'nomicon',
    label: 'Nomicon (NEAR protocol specification)',
    sitemap: 'https://nomicon.io/sitemap.xml',
    origin: 'https://nomicon.io',
    include: /^https:\/\/nomicon\.io\/(?!search$|markdown-page$)[A-Za-z0-9/_-]+$/,
    titleSuffix: /\s+-\s+(?:Guide to Nearcore Development|NEAR Protocol Specification|Nomicon)\s*$/,
  },
];

const MIN_TEXT = 30;

export function siteDocUrls(sitemapXml: string, site: SiteDocs): string[] {
  const urls = (sitemapXml.match(/<loc>([^<]+)<\/loc>/g) ?? []).map((m) => m.replace(/<\/?loc>/g, '').trim().replace(/\/$/, ''));
  return [...new Set(urls.filter((u) => site.include.test(u)))];
}

export function parseSiteDoc(html: string, url: string, site: SiteDocs): NearDocPage | null {
  const main = extractMain(html);
  if (!main) return null;
  const text = htmlToTextWithCode(main);
  if (text.length < MIN_TEXT) return null;
  const title = extractTitle(html).replace(site.titleSuffix, '').trim() || url;
  return singleDocPage(`# ${title}\n\n${text}`, url);
}
