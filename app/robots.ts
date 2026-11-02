import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site.config';

// Paths to keep out of any crawler: operational endpoints that answer to
// machines, not readers. The admin surface used to head this list and no
// longer exists.
const PRIVATE_DISALLOW = ['/api/metrics', '/api/csp-report'];

// AI-tool bots are explicitly invited to /api/v1 (REST) and /mcp
// (MCP server) - that's the whole point of /for-ai. Other crawlers
// get a smaller surface to avoid noisy duplicate-content reports.
const AI_BOTS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'PerplexityBot',
  'ClaudeBot',
  'anthropic-ai',
  'Google-Extended',
  'Gemini-Extended',
  'cohere-ai',
  'Applebot-Extended',
  'Meta-ExternalAgent',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Default: standard search crawlers - keep them off the API noise.
      {
        userAgent: '*',
        allow: '/',
        disallow: [...PRIVATE_DISALLOW, '/api/'],
      },
      // AI bots: allow the documented REST endpoints + MCP.
      ...AI_BOTS.map(userAgent => ({
        userAgent,
        allow: ['/', '/api/v1/', '/mcp'],
        disallow: PRIVATE_DISALLOW,
      })),
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
