/**
 * The documented REST API surface, hand-maintained.
 *
 * Single source of truth for two consumers that must never drift apart:
 * app/for-ai/page.tsx renders it for humans, scripts/check-endpoints.ts
 * calls every one of them and refuses a 5xx. A plain module (no `next/*`,
 * no `@/` alias) so scripts/check-endpoints.ts can import it under tsx
 * without going through the Next.js build - the same reason every
 * scripts/*.ts file uses relative imports instead of `@/`.
 */
export const ENDPOINTS = [
  { path: '/api/v1/cips', desc: 'List CIPs', params: 'status, type, limit, offset' },
  { path: '/api/v1/cips/:id', desc: 'Get single CIP with full content', params: 'id: "0042", "CIP-0042", "PR-0117"' },
  { path: '/api/v1/cips/:id/history', desc: 'CIP status change history', params: 'CIP id' },
  { path: '/api/v1/cips/:id/attachments', desc: 'CIP file attachments', params: 'CIP id' },
  { path: '/api/v1/search', desc: 'Full-text search across all content', params: 'q, type (all|cip|doc|discussion|whitepaper|blog|youtube|github), limit' },
  { path: '/api/v1/discussions', desc: 'List forum topics', params: 'limit, offset, category' },
  { path: '/api/v1/discussions/:id', desc: 'Get topic with posts', params: 'topic id' },
  { path: '/api/v1/docs', desc: 'List documentation pages', params: 'source, limit, offset' },
  { path: '/api/v1/docs/:id', desc: 'Get full doc page content', params: 'doc id' },
  { path: '/api/v1/whitepapers', desc: 'List all whitepapers', params: '' },
  { path: '/api/v1/whitepapers/:slug', desc: 'Get whitepaper with extracted text', params: 'slug' },
  { path: '/api/v1/trending', desc: 'Trending content this week', params: '' },
  { path: '/api/v1/radar', desc: 'Breaking changes and deadlines', params: 'level (all|critical|important|ecosystem)' },
  { path: '/api/v1/blog', desc: 'Blog posts: articles, news and press releases, with tabs for partner press, notices and reprints', params: 'source, q, limit, offset' },
  { path: '/api/v1/videos', desc: 'YouTube videos', params: 'channel, since, has_transcript, limit, offset' },
  { path: '/api/v1/stats', desc: 'Network stats snapshot + history', params: '' },
  { path: '/api/v1/repos', desc: 'Indexed GitHub repositories', params: '' },
  { path: '/api/v1/code', desc: 'GitHub issues and PRs browser', params: 'repo, state, type, q, limit, offset' },
  { path: '/api/v1/ecosystem', desc: 'yourchain.example/ecosystem project catalog', params: 'category, q, limit, offset' },
  { path: '/api/v1/cips/graph', desc: 'CIP requires dependency graph', params: '' },
  { path: '/api/v1/blog/:id', desc: 'Single blog post; reprints and partner press come as an excerpt', params: 'post id' },
  { path: '/api/v1/videos/:id', desc: 'Single YouTube video metadata + transcript, with the time of each line', params: 'video id' },
  { path: '/api/v1/github-discussions', desc: 'GitHub Discussions (your-org/docs Q&A)', params: 'repo, category, limit, offset' },
  { path: '/api/v1/github-discussions/:id', desc: 'Single discussion with body + comments', params: 'discussion node id' },
  { path: '/api/v1/searches/popular', desc: 'Top human search queries on /search', params: 'window (days, 1-90), limit' },
  { path: '/api/v1/searches/zero', desc: 'Distinct search queries that returned 0 results - content-gap signal', params: 'window, limit' },
  { path: 'POST /api/v1/cips/batch', desc: 'Bulk CIP lookup (≤50 ids)', params: 'Body: { ids: string[] } - accepts 0042, CIP-0042, PR-0117' },
  { path: '/api/v1/cips/:id/tldr', desc: 'Cached 2-3 sentence TL;DR - read-only, never triggers LLM generation', params: 'CIP id' },
  { path: '/api/v1/cips/tldrs', desc: 'Batch cached TL;DRs for up to 50 CIPs in one call', params: 'ids=0001,CIP-0042,PR-117' },
  { path: '/api/v1/cips/:id/mentions', desc: 'Aggregated backlinks: forum threads, blog posts, sibling CIPs', params: 'CIP id' },
  { path: '/api/v1/sources', desc: 'Discovery: one row per content type with current count + last-synced timestamp', params: '' },
  { path: '/api/v1/network', desc: 'LIVE YourChain on-chain state + TKN market (Explorer + CoinGecko)', params: '' },
  { path: '/api/v1/changes', desc: 'Unified activity feed: CIP transitions, forum threads, blog posts, releases, radar items - merged descending-by-time', params: 'days (1-90), limit (1-500)' },
  { path: '/api/v1/csp-violations', desc: 'Aggregated CSP violations grouped by directive - for security monitoring dashboards', params: 'window (days, 1-90), limit (top blocked_uris per directive, 1-25)' },
  { path: '/api/v1/openapi.json', desc: 'OpenAPI 3.1 description of every endpoint - feed to Swagger UI / OpenAI function-calling / Postman', params: '' },
  { path: '/api/v1/reference', desc: 'Interactive API reference (Scalar) rendered from the OpenAPI spec - open in a browser to explore + try endpoints', params: '' },
  { path: '/api/v1', desc: 'API index - lists every v1 endpoint with a one-line description', params: '' },
  { path: '/health', desc: 'Liveness probe + MCP tool count', params: '' },
];
