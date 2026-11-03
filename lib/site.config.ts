const PUBLISHER = {
  name: 'Unity Nodes',
  url: 'https://unitynodes.com',
  twitter: 'https://x.com/UnityNodes',
} as const;

/**
 * The public origin comes from the environment, never from a literal, so the
 * same build runs on the production domain, a scratch port or a preview host.
 * A missing NEXT_PUBLIC_SITE_URL in production would put localhost into every
 * sitemap, canonical and feed, so `.env.production` has to set it.
 */
const ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3130').replace(/\/+$/, '');

const HOST = new URL(ORIGIN).hostname;

export const SITE = {
  name: 'NEARpedia',
  slug: 'nearpedia',
  tagline: 'Live NEAR knowledge for AI agents',
  subject: 'NEAR',
  description:
    'A live knowledge layer for NEAR: deprecations, breaking changes, protocol upgrades, governance and docs, served over MCP and REST with a source and a date on every answer.',
  disclaimer:
    'NEARpedia is an independent, unofficial project by Unity Nodes. It is not affiliated with or endorsed by the NEAR Foundation.',
  url: ORIGIN,
  host: HOST,
  twitter: PUBLISHER.twitter,
  publisher: PUBLISHER,
  repo: 'https://github.com/UnityNodes/near-pedia',
  logo: {
    light: '/brand/logo-horizontal-light.svg',
    dark: '/brand/logo-horizontal-dark.svg',
    mark: '/brand/mark-dark.svg',
    icon: '/icon-512.png',
  },
} as const;

export const SITE_TITLE = `${SITE.name} | ${SITE.tagline}`;
