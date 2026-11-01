import type { MetadataRoute } from 'next';
import { SITE, SITE_TITLE } from '@/lib/site.config';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_TITLE,
    short_name: SITE.name,
    description:
      'CIPs, docs, discussions and whitepapers for the NEAR ecosystem - indexed, searchable, always current.',
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
