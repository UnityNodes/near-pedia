import type { MetadataRoute } from 'next';

// Paths to keep out of any crawler: operational endpoints that answer to
// machines, not readers. The admin surface used to head this list and no
// longer exists.
const PRIVATE_DISALLOW = ['/api/metrics', '/api/csp-report'];

// AI bots get an extra carve-out: the per-CIP TLDR generation endpoint
// (/api/cips/:id/tldr) costs LLM quota per call. The cached TLDR is
// already exposed via /api/v1/cips/:id/tldr on the REST side and via
// the CIP page itself - there's no value in crawling the trigger.
const AI_BOT_EXTRA_DISALLOW = ['/api/cips/'];

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
      // AI bots: allow the documented REST endpoints + MCP, but route
      // them away from the LLM-cost endpoints - they have a cached
      // mirror under /api/v1/cips/:id/tldr.
      ...AI_BOTS.map(userAgent => ({
        userAgent,
        allow: ['/', '/api/v1/', '/mcp'],
        disallow: [...PRIVATE_DISALLOW, ...AI_BOT_EXTRA_DISALLOW],
      })),
    ],
    sitemap: 'https://yourpedia.example/sitemap.xml',
    host: 'https://yourpedia.example',
  };
}
