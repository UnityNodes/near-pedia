export const SITE = {
  name: 'YOURPEDIA',
  tagline: 'YourChain Knowledge Hub',
  description:
    'CIPs, docs, discussions, whitepapers and ecosystem activity for the YourChain ecosystem, indexed, searchable, always current.',
  url: 'https://yourpedia.example',
  publisher: {
    name: 'Your Organization',
    url: 'https://example.com',
    twitter: 'https://x.com/your-handle',
  },
  logo: {
    light: '/logo-light.png',
    dark: '/logo-dark.png',
    icon: '/icon.png',
  },
} as const;

export const SITE_TITLE = `${SITE.name} | ${SITE.tagline}`;
