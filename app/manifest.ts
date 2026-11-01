import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'YOURPEDIA - YourChain Knowledge Hub',
    short_name: 'YOURPEDIA',
    description:
      'CIPs, docs, discussions and whitepapers for the YourChain ecosystem - indexed, searchable, always current.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0A0B0F',
    theme_color: '#0A0B0F',
    categories: ['developer', 'productivity', 'news', 'finance'],
    icons: [
      {
        src: '/icon.png',
        type: 'image/png',
        sizes: '512x512',
        purpose: 'any',
      },
      {
        src: '/logo-dark.png',
        type: 'image/png',
        sizes: '512x512',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'Browse CIPs',
        short_name: 'CIPs',
        description: 'Chain Improvement Proposals',
        url: '/cips',
      },
      {
        name: 'Live Sources',
        short_name: 'Sources',
        description: 'Every indexed source with live record counts',
        url: '/sources',
      },
    ],
  };
}
