import type { Metadata } from 'next';
import { SITE } from './site.config';

/**
 * Default OG and Twitter images. Next.js auto-inherits opengraph-image.tsx
 * from app/ ONLY when a page does NOT override `metadata.openGraph`. As soon
 * as a page declares its own openGraph object, the auto-inheritance is lost
 * - so we have to include `images` explicitly. This helper centralises that.
 */
export const SITE_URL = SITE.url;
export const SITE_NAME = SITE.name;

export const DEFAULT_OG_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  alt: `${SITE.name} | ${SITE.tagline}`,
};

export const DEFAULT_TWITTER_IMAGE = {
  url: '/twitter-image',
  width: 1200,
  height: 630,
  alt: `${SITE.name} | ${SITE.tagline}`,
};

interface PageMetaInput {
  title: string;
  description: string;
  path: string;                          // e.g. '/stats', '/cips/0042'
  ogType?: 'website' | 'article';        // default: 'website'
  extraOpenGraph?: Record<string, unknown>;
  extraTwitter?: Record<string, unknown>;
  alternates?: Metadata['alternates'];
}

/**
 * Build a Next.js Metadata object. Pass the BARE page title — the helper
 * appends ` | ${SITE_NAME}` for the OG/Twitter card so brand suffix never
 * needs to be hardcoded per page.
 */
export function pageMetadata({
  title,
  description,
  path,
  ogType = 'website',
  extraOpenGraph = {},
  extraTwitter = {},
  alternates,
}: PageMetaInput): Metadata {
  const url = `${SITE_URL}${path}`;
  const brandedTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;
  return {
    title,
    description,
    alternates: alternates ?? { canonical: path },
    openGraph: {
      type: ogType,
      siteName: SITE_NAME,
      title: brandedTitle,
      description,
      url,
      images: [DEFAULT_OG_IMAGE],
      ...extraOpenGraph,
    },
    twitter: {
      card: 'summary_large_image',
      title: brandedTitle,
      description,
      images: [DEFAULT_TWITTER_IMAGE],
      ...extraTwitter,
    },
  };
}
