import type { MetadataRoute } from 'next';
import { SITE, SITE_TITLE } from '@/lib/site.config';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_TITLE,
    short_name: SITE.name,
    description:
      'NEAR deprecations, docs, releases, governance and discussions - indexed, searchable, always current.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0B0B0C',
    theme_color: '#0B0B0C',
    categories: ['developer', 'productivity', 'news', 'finance'],
    icons: [
      { src: '/icon-192.png', type: 'image/png', sizes: '192x192', purpose: 'any' },
      { src: '/icon-512.png', type: 'image/png', sizes: '512x512', purpose: 'any' },
      { src: '/icon-maskable-512.png', type: 'image/png', sizes: '512x512', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Deprecations',
        short_name: 'Deprecations',
        description: 'What NEAR removed, deprecated or replaced',
        url: '/deprecations',
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
