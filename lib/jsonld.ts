/**
 * JSON-LD structured data helpers. Emit per-page Schema.org payloads so
 * Google, Bing and AI crawlers correctly classify YOURPEDIA content.
 */
import { SITE } from './site.config';

const SITE_URL = SITE.url;
const PUBLISHER = {
  '@type': 'Organization',
  name: SITE.name,
  url: SITE_URL,
};

export function breadcrumbList(items: Array<{ name: string; path: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: `${SITE_URL}${it.path}`,
    })),
  };
}

export function collectionPage(opts: {
  name: string;
  description: string;
  path: string;
  itemCount?: number;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: opts.name,
    description: opts.description,
    url: `${SITE_URL}${opts.path}`,
    publisher: PUBLISHER,
    isPartOf: { '@type': 'WebSite', name: SITE.name, url: SITE_URL },
    ...(opts.itemCount != null ? {
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: opts.itemCount,
      },
    } : {}),
  };
}

export function techArticle(opts: {
  headline: string;
  description: string;
  path: string;
  datePublished?: string | null;
  dateModified?: string | null;
  author?: string | null;
  section?: string;
  keywords?: string[];
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: opts.headline,
    description: opts.description,
    url: `${SITE_URL}${opts.path}`,
    publisher: PUBLISHER,
    isPartOf: { '@type': 'WebSite', name: SITE.name, url: SITE_URL },
    ...(opts.datePublished ? { datePublished: opts.datePublished } : {}),
    ...(opts.dateModified ? { dateModified: opts.dateModified } : {}),
    ...(opts.author ? { author: { '@type': 'Person', name: opts.author } } : {}),
    ...(opts.section ? { articleSection: opts.section } : {}),
    ...(opts.keywords ? { keywords: opts.keywords.filter(Boolean).join(', ') } : {}),
  };
}

export function dataset(opts: {
  name: string;
  description: string;
  path: string;
  apiPath?: string;
  modified?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: opts.name,
    description: opts.description,
    url: `${SITE_URL}${opts.path}`,
    publisher: PUBLISHER,
    isPartOf: { '@type': 'WebSite', name: SITE.name, url: SITE_URL },
    ...(opts.modified ? { dateModified: opts.modified } : {}),
    ...(opts.apiPath ? {
      distribution: [{
        '@type': 'DataDownload',
        encodingFormat: 'application/json',
        contentUrl: `${SITE_URL}${opts.apiPath}`,
      }],
    } : {}),
  };
}

export function jsonLdScript(payload: unknown) {
  return {
    type: 'application/ld+json',
    dangerouslySetInnerHTML: { __html: JSON.stringify(payload) },
  };
}

export function definedTermSet(opts: {
  path: string;
  name: string;
  terms: Array<{ id: string; name: string; description: string; alternateName?: string[] }>;
}) {
  const setUrl = `${SITE_URL}${opts.path}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'DefinedTermSet',
    '@id': setUrl,
    name: opts.name,
    url: setUrl,
    hasDefinedTerm: opts.terms.map(t => ({
      '@type': 'DefinedTerm',
      '@id': `${setUrl}#${t.id}`,
      name: t.name,
      ...(t.alternateName?.length ? { alternateName: t.alternateName } : {}),
      description: t.description,
      url: `${setUrl}#${t.id}`,
      inDefinedTermSet: setUrl,
    })),
  };
}
