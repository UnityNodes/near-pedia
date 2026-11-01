import type { MetadataRoute } from 'next';
import { getCips } from '@/lib/cips';
import { getBlogPosts } from '@/lib/blog';
import { releaseFeed } from '@/lib/releases';
import { getTopics } from '@/lib/forum';
import { getDocs } from '@/lib/docs';
import { getVideos } from '@/lib/videos';
import { getAllWhitepapers } from '@/lib/whitepapers';
import { SITE } from '@/lib/site.config';

export const revalidate = 3600;

const BASE = SITE.url;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date().toISOString();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE}/cips`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/discussions`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE}/docs`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE}/whitepapers`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE}/blog`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE}/releases`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE}/videos`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE}/resources`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE}/code`, lastModified: now, changeFrequency: 'daily', priority: 0.6 },
    { url: `${BASE}/sources`, lastModified: now, changeFrequency: 'daily', priority: 0.5 },
    { url: `${BASE}/ecosystem`, lastModified: now, changeFrequency: 'daily', priority: 0.6 },
    { url: `${BASE}/cips/graph`, lastModified: now, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${BASE}/trending`, lastModified: now, changeFrequency: 'hourly', priority: 0.6 },
    { url: `${BASE}/for-ai`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE}/search`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/digest`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE}/feed`, lastModified: now, changeFrequency: 'daily', priority: 0.5 },
    { url: `${BASE}/validators`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE}/security`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];

  // perPage sized for the long tail. Previously these were 200-2000
  // and silently truncated - blog had 468 posts but sitemap exposed
  // 200, docs had 2.8k but sitemap exposed 2k. Google caps a single
  // sitemap at 50k URLs; we're under that even summed.
  const PER_PAGE = 10_000;

  const { cips } = getCips({ perPage: PER_PAGE });
  const cipRoutes: MetadataRoute.Sitemap = cips.map(c => ({
    url: `${BASE}/cips/${c.id}`,
    lastModified: c.synced_at ?? now,
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  const { posts: blogPosts } = getBlogPosts({ perPage: PER_PAGE });
  const blogRoutes: MetadataRoute.Sitemap = blogPosts.map(p => ({
    url: `${BASE}/blog/${p.id}`,
    lastModified: p.published_at ?? now,
    changeFrequency: 'monthly',
    priority: 0.5,
  }));

  const releaseRoutes: MetadataRoute.Sitemap = releaseFeed().map(r => ({
    url: `${BASE}/releases/${r.id}`,
    lastModified: r.date ?? now,
    changeFrequency: 'monthly',
    priority: 0.5,
  }));

  const { topics } = getTopics({ sort: 'activity', perPage: PER_PAGE });
  const discussionRoutes: MetadataRoute.Sitemap = topics.map(t => ({
    url: `${BASE}/discussions/${t.id}`,
    lastModified: t.last_post_at ?? now,
    changeFrequency: 'weekly',
    priority: 0.5,
  }));

  const { docs } = getDocs({ perPage: PER_PAGE });
  const docRoutes: MetadataRoute.Sitemap = docs.map(d => ({
    url: `${BASE}/docs/${d.id}`,
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.4,
  }));

  const { videos } = getVideos({ perPage: PER_PAGE });
  const videoRoutes: MetadataRoute.Sitemap = videos.map(v => ({
    url: `${BASE}/videos/${v.id}`,
    lastModified: v.published_at ?? now,
    changeFrequency: 'monthly',
    priority: 0.4,
  }));

  const whitepapers = getAllWhitepapers();
  const whitepaperRoutes: MetadataRoute.Sitemap = whitepapers.map(w => ({
    url: `${BASE}/whitepapers/${w.slug}`,
    lastModified: now,
    changeFrequency: 'yearly',
    priority: 0.7,
  }));

  return [
    ...staticRoutes,
    ...cipRoutes,
    ...blogRoutes,
    ...releaseRoutes,
    ...discussionRoutes,
    ...docRoutes,
    ...videoRoutes,
    ...whitepaperRoutes,
  ];
}
