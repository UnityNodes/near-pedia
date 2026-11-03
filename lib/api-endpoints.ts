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
  { path: '/api/v1/proposals', desc: 'House of Stake proposals from vote.dao with vote standing and forum thread', params: 'status, q, limit' },
  { path: '/api/v1/proposals/:ref', desc: 'One House of Stake proposal with its text', params: 'on-chain id or HSP number, e.g. "27" or "HSP-027"' },
  { path: '/api/v1/projects', desc: 'NEAR Catalog projects with TVL on NEAR (DefiLlama) and partner flag; without q, the top projects by TVL', params: 'q, category, limit' },
  { path: '/api/v1/projects/:slug', desc: 'One NEAR Catalog project with tokens, TVL components and security incidents', params: 'catalog slug, e.g. "ref-finance"' },
  { path: '/api/v1/incidents', desc: 'Security incidents in the NEAR ecosystem (DefiLlama hacks), newest first', params: 'relevance (near|related|all), q, project, limit' },
  { path: '/api/v1/incidents/:id', desc: 'One security incident', params: 'incident id from /api/v1/incidents, e.g. "llama-1546-2026-04-16"' },
  { path: '/api/v1/partners', desc: 'NEAR partners (Intents, OutLayer, Trezu, HOT, Rhea): contracts, GitHub, docs feeds', params: '' },
  { path: '/api/v1/partners/:id', desc: 'One partner with its catalog projects and incidents', params: 'partner id, e.g. "near-intents"' },
  { path: '/api/v1/protocol', desc: 'Protocol version, upgrade vote by stake, epoch progress and upgrade schedule of mainnet and testnet', params: 'network (mainnet|testnet)' },
  { path: '/api/v1/packages/:name', desc: 'One npm or crates.io package (optionally name@version): latest, yanked or deprecated, the deprecation entry', params: 'name, e.g. "near-api-js@5.0.0" or "crates:near-sdk"' },
  { path: 'POST /api/v1/explain-error', desc: 'A NEAR error explained: catalog entry from docs.near.org, deprecations it names, forum threads and GitHub issues', params: 'Body: { error_text: string }' },
  { path: '/api/v1/standards', desc: 'NEAR standards (NEPs) from github.com/near/NEPs', params: 'q (words in title or text)' },
  { path: '/api/v1/standards/:nep', desc: 'One NEP with its full text and what it requires, replaces or is replaced by', params: 'nep, e.g. "141"' },
  { path: '/api/v1/contracts/:account', desc: 'What is deployed on an account, live from RPC: methods, standards, NEP-330 source metadata, token metadata', params: 'account id; network (mainnet|testnet)' },
  { path: '/api/v1/anchors', desc: 'Daily database hashes, each with where it is recorded on NEAR (contract, transaction, block)', params: 'limit' },
  { path: '/api/v1/anchors/:date', desc: 'One day\'s database hash with its per-table manifest', params: 'date, YYYY-MM-DD' },
  { path: 'POST /api/v1/ask', desc: 'Answer a NEAR question (optionally about one pasted file) through NEAR AI Cloud, from this index\'s sources, with a verified response signature and a link to NEAR AI\'s Verification Center', params: 'Body: { question: string (≤2000 chars), code?: string (≤20000 chars), filename?, history?: [{ question, answer }] (the last 3 turns, so a follow-up can refer to them) }. 30 an hour per address' },
  { path: 'POST /api/v1/check-code', desc: 'Check one NEAR source file or manifest for removed, deprecated, changed or superseded APIs and outdated dependencies', params: 'Body: { code: string (≤100000 chars), filename?, language? (js|rust|cargo|package-json|json|toml|text) }' },
  { path: '/api/v1/deprecations', desc: 'Deprecated, removed and changed NEAR packages, APIs and services, each with evidence', params: 'q, kind, status, limit, offset' },
  { path: '/api/v1/deprecations/:id', desc: 'One deprecation entry with every piece of evidence', params: 'entry id, e.g. "near-sdk-js"' },
  { path: '/api/v1/search', desc: 'Full-text search across all content', params: 'q, type (all|doc|discussion|blog|youtube|github), limit' },
  { path: '/api/v1/discussions', desc: 'List forum topics', params: 'limit, offset, category' },
  { path: '/api/v1/discussions/:id', desc: 'Get topic with posts', params: 'topic id' },
  { path: '/api/v1/docs', desc: 'List documentation pages', params: 'source, limit, offset' },
  { path: '/api/v1/docs/:id', desc: 'Get full doc page content', params: 'doc id' },
  { path: '/api/v1/radar', desc: 'Breaking changes and deadlines', params: 'level (all|critical|important|ecosystem)' },
  { path: '/api/v1/blog', desc: 'Blog posts: articles, news and press releases, with tabs for partner press, notices and reprints', params: 'source, q, limit, offset' },
  { path: '/api/v1/videos', desc: 'YouTube videos', params: 'channel, since, has_transcript, limit, offset' },
  { path: '/api/v1/stats', desc: 'Network stats snapshot + history', params: '' },
  { path: '/api/v1/repos', desc: 'Indexed GitHub repositories', params: '' },
  { path: '/api/v1/code', desc: 'GitHub issues and PRs browser', params: 'repo, state, type, q, limit, offset' },
  { path: '/api/v1/ecosystem', desc: 'NEAR Catalog project catalog', params: 'category, q, limit, offset' },
  { path: '/api/v1/blog/:id', desc: 'Single blog post; reprints and partner press come as an excerpt', params: 'post id' },
  { path: '/api/v1/videos/:id', desc: 'Single YouTube video metadata + transcript, with the time of each line', params: 'video id' },
  { path: '/api/v1/github-discussions', desc: 'GitHub Discussions (near/docs and other NEAR repos)', params: 'repo, category, limit, offset' },
  { path: '/api/v1/github-discussions/:id', desc: 'Single discussion with body + comments', params: 'discussion node id' },
  { path: '/api/v1/searches/popular', desc: 'Top human search queries on /search', params: 'window (days, 1-90), limit' },
  { path: '/api/v1/searches/zero', desc: 'Distinct search queries that returned 0 results - content-gap signal', params: 'window, limit' },
  { path: '/api/v1/sources', desc: 'Discovery: one row per content type with current count + last-synced timestamp', params: '' },
  { path: '/api/v1/network', desc: 'LIVE NEAR on-chain state + NEAR market (Explorer + CoinGecko)', params: '' },
  { path: '/api/v1/changes', desc: 'Unified activity feed: NEAR change events, forum threads, blog posts, releases, radar items - merged descending-by-time', params: 'days (1-90), limit (1-500)' },
  { path: '/api/v1/csp-violations', desc: 'Aggregated CSP violations grouped by directive - for security monitoring dashboards', params: 'window (days, 1-90), limit (top blocked_uris per directive, 1-25)' },
  { path: '/api/v1/openapi.json', desc: 'OpenAPI 3.1 description of every endpoint - feed to Swagger UI / OpenAI function-calling / Postman', params: '' },
  { path: '/api/v1/reference', desc: 'Interactive API reference (Scalar) rendered from the OpenAPI spec - open in a browser to explore + try endpoints', params: '' },
  { path: '/api/v1', desc: 'API index - lists every v1 endpoint with a one-line description', params: '' },
  { path: '/health', desc: 'Liveness probe + MCP tool count', params: '' },
];
