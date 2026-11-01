/**
 * OpenAPI 3.1 description of the public NEAR-pedia REST API.
 *
 * Source of truth: this file. The /api/v1/openapi.json endpoint
 * serves it as-is; the /for-ai page renders a human view. When you
 * add a route to mcp-server.ts you also add it here - that's the
 * contract.
 *
 * Schemas are deliberately loose ({type: 'object'}) for endpoints
 * whose response shape is documented inline in the description and
 * isn't worth duplicating. The few endpoints where downstream
 * agents lean on structure (cips/batch, cips/tldrs, changes,
 * sources, csp-violations) get explicit schemas.
 */

import { SITE } from './site.config';

const ID_PATTERN = '^(\\d{1,4}|CIP-\\d{1,4}|cip-\\d{1,4}|PR-\\d+)$';

const COMMON_400 = {
  description: 'Bad request - invalid path / query param',
  content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } },
};
const COMMON_404 = {
  description: 'Not found',
  content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } },
};

export const OPENAPI_SPEC = {
  openapi: '3.1.0',
  info: {
    title: `${SITE.name} REST API`,
    version: '1.0.0',
    summary: 'NEAR knowledge base - machine-readable access',
    description:
      `Public, unauthenticated REST API over the ${SITE.name} corpus: CIPs, ` +
      'documentation, forum threads, whitepapers, blog ' +
      'posts, videos, ecosystem projects, GitHub items, releases, ' +
      'on-chain network state, market data, and the RAG embedding ' +
      'index. Same data the website renders; same search engine the ' +
      'website uses (lib/search.ts unifiedSearch).',
    contact: { name: SITE.publisher.name, url: SITE.publisher.url },
    license: { name: 'MIT' },
  },
  servers: [{ url: SITE.url, description: 'production' }],
  externalDocs: {
    description: '/for-ai - human-readable endpoint catalog and MCP integration guide',
    url: `${SITE.url}/for-ai`,
  },
  tags: [
    { name: 'CIPs',          description: 'Chain Improvement Proposals' },
    { name: 'Search',        description: 'Full-text + fuzzy search across all sources' },
    { name: 'Discussions',   description: 'Forum, GitHub Discussions' },
    { name: 'Documentation', description: 'docs.yourchain.example pages, whitepapers' },
    { name: 'GitHub',        description: 'Issues, PRs, releases, repos' },
    { name: 'Network',       description: 'On-chain state, market data, stats' },
    { name: 'Discovery',     description: 'Activity stream, sources catalog' },
    { name: 'Analytics',     description: 'Search popularity, CSP violations' },
    { name: 'Meta',          description: 'API self-description' },
  ],
  paths: {
    '/api/v1': { get: { tags: ['Meta'], summary: 'Endpoint index + schema', responses: { '200': { description: 'Endpoint list' } } } },
    '/api/v1/openapi.json': { get: { tags: ['Meta'], summary: 'This document (OpenAPI 3.1)', responses: { '200': { description: 'OpenAPI document' } } } },
    '/api/v1/reference': { get: { tags: ['Meta'], summary: 'Interactive API reference (Scalar, HTML)', responses: { '200': { description: 'HTML documentation page', content: { 'text/html': {} } } } } },
    '/health': { get: { tags: ['Meta'], summary: 'Liveness probe + registered MCP tool count', responses: { '200': { description: 'Service status' } } } },

    '/api/v1/cips': {
      get: {
        tags: ['CIPs'], summary: 'List CIPs with optional filters',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['Draft','Review','Final','Withdrawn','Rejected','Superseded'] } },
          { name: 'type',   in: 'query', schema: { type: 'string' } },
          { name: 'limit',  in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
        ],
        responses: { '200': { description: 'Paginated CIP list' } },
      },
    },
    '/api/v1/cips/{id}': {
      get: {
        tags: ['CIPs'], summary: 'Single CIP with full content',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: ID_PATTERN } }],
        responses: { '200': { description: 'CIP row + url' }, '400': COMMON_400, '404': COMMON_404 },
      },
    },
    '/api/v1/cips/{id}/history': {
      get: {
        tags: ['CIPs'], summary: 'Status transition history for a CIP',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: ID_PATTERN } }],
        responses: { '200': { description: 'Status change events sorted DESC' }, '400': COMMON_400, '404': COMMON_404 },
      },
    },
    '/api/v1/cips/{id}/attachments': {
      get: {
        tags: ['CIPs'], summary: 'File attachments (PDFs, signed votes)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: ID_PATTERN } }],
        responses: { '200': { description: 'Attachment list' }, '400': COMMON_400, '404': COMMON_404 },
      },
    },
    '/api/v1/cips/{id}/tldr': {
      get: {
        tags: ['CIPs'], summary: 'Cached 2-3 sentence TL;DR (no LLM cost)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: ID_PATTERN } }],
        responses: {
          '200': {
            description: 'TLDR (may be null if not yet generated)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CipTldr' } } },
          },
          '400': COMMON_400, '404': COMMON_404,
        },
      },
    },
    '/api/v1/cips/{id}/mentions': {
      get: {
        tags: ['CIPs'], summary: 'Backlinks: forum, blog, sibling CIPs',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: ID_PATTERN } }],
        responses: { '200': { description: 'Mention aggregates with counts subobject' }, '400': COMMON_400, '404': COMMON_404 },
      },
    },
    '/api/v1/cips/tldrs': {
      get: {
        tags: ['CIPs'], summary: 'Batch cached TL;DRs (up to 50 ids)',
        parameters: [{ name: 'ids', in: 'query', required: true, schema: { type: 'string' }, description: 'Comma-separated id list, max 50' }],
        responses: { '200': { description: 'Items in input order with nulls for misses' }, '400': COMMON_400 },
      },
    },
    '/api/v1/cips/batch': {
      post: {
        tags: ['CIPs'], summary: 'Bulk CIP lookup (up to 50 ids)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'string' }, maxItems: 50 } } } } },
        },
        responses: { '200': { description: 'Items in input order' }, '400': COMMON_400 },
      },
    },
    '/api/v1/cips/graph': { get: { tags: ['CIPs'], summary: 'requires-dependency graph (nodes + edges)', responses: { '200': { description: 'Graph payload' } } } },

    '/api/v1/search': {
      get: {
        tags: ['Search'], summary: 'Unified search (FTS5 + fuzzy fallback)',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['all','cip','doc','discussion','whitepaper','blog','youtube','github'], default: 'all' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
        ],
        responses: { '200': { description: 'Ranked result list' }, '400': COMMON_400 },
      },
    },

    '/api/v1/discussions':         { get: { tags: ['Discussions'], summary: 'Forum topics', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }, { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }, { name: 'category', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'Topic list' } } } },
    '/api/v1/discussions/{id}':    { get: { tags: ['Discussions'], summary: 'Forum topic with posts', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Topic + posts' }, '404': COMMON_404 } } },
    '/api/v1/github-discussions':  { get: { tags: ['Discussions'], summary: 'GitHub Discussions (your-org/docs)', parameters: [{ name: 'repo', in: 'query', schema: { type: 'string' } }, { name: 'category', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'Discussion list' } } } },
    '/api/v1/github-discussions/{id}': { get: { tags: ['Discussions'], summary: 'Single GitHub Discussion with comments', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Discussion + comments' }, '404': COMMON_404 } } },

    '/api/v1/docs':                { get: { tags: ['Documentation'], summary: 'Documentation page list', parameters: [{ name: 'source', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }, { name: 'offset', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'Doc page list' } } } },
    '/api/v1/docs/{id}':           { get: { tags: ['Documentation'], summary: 'Full doc page content', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Doc page' }, '404': COMMON_404 } } },
    '/api/v1/whitepapers':         { get: { tags: ['Documentation'], summary: 'All whitepapers', responses: { '200': { description: 'Whitepaper list' } } } },
    '/api/v1/whitepapers/{slug}':  { get: { tags: ['Documentation'], summary: 'Whitepaper with extracted text', parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Whitepaper detail' }, '404': COMMON_404 } } },

    '/api/v1/trending':            { get: { tags: ['Discovery'], summary: 'Trending content this week', responses: { '200': { description: 'Trending list' } } } },
    '/api/v1/deprecations':        { get: { tags: ['Discovery'], summary: 'Deprecated, removed and changed NEAR packages, APIs and services', parameters: [{ name: 'q', in: 'query', schema: { type: 'string' }, description: 'A package, crate, repository, RPC method, identifier or endpoint host' }, { name: 'kind', in: 'query', schema: { type: 'string', enum: ['package','crate','repo','rpc_method','protocol','api','service','config','product'] } }, { name: 'status', in: 'query', schema: { type: 'string', enum: ['deprecated','removed','changed','possibly_deprecated'] } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } }, { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }], responses: { '200': { description: 'Entries, without evidence; fetch one by id for its evidence' } } } },
    '/api/v1/deprecations/{id}':   { get: { tags: ['Discovery'], summary: 'One deprecation entry with its evidence', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'The entry and every piece of evidence, each with source URL, quote, date and how it was checked' }, '404': { description: 'No such entry' } } } },
    '/api/v1/radar':               { get: { tags: ['Discovery'], summary: 'Breaking changes / deadlines', parameters: [{ name: 'level', in: 'query', schema: { type: 'string', enum: ['all','critical','important','ecosystem'], default: 'all' } }], responses: { '200': { description: 'Radar items' } } } },
    '/api/v1/blog':                { get: { tags: ['Discovery'], summary: 'Blog posts', description: 'The posts the Blog page shows under All (first-party writing), or one tab of it. Each item says whether the whole text is served (full) or an excerpt with a link to the original.', parameters: [{ name: 'source', in: 'query', description: 'Tab of the Blog page. Omit for All.', schema: { type: 'string', enum: ['blog', 'news', 'press-release', 'partner-news', 'third-party'] } }, { name: 'q', in: 'query', description: 'Words to look for in titles and text; results come best match first.', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }, { name: 'offset', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'Blog post list: total, limit, offset and items with id, title, excerpt, kind, source, author, published_at, served, url and original_url' } } } },
    '/api/v1/blog/{id}':           { get: { tags: ['Discovery'], summary: 'Single blog post', description: 'Reprints and partner press carry an excerpt and no text; everything else carries its text. Returns 404 when the id is unknown or is release notes.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Blog post detail' }, '404': COMMON_404 } } },
    '/api/v1/videos':              { get: { tags: ['Discovery'], summary: 'YouTube videos', parameters: [{ name: 'channel', in: 'query', schema: { type: 'string' } }, { name: 'since', in: 'query', description: 'Earliest published date, ISO (for example 2026-01-01).', schema: { type: 'string' } }, { name: 'has_transcript', in: 'query', description: 'true for videos with a stored transcript, false for those without one.', schema: { type: 'string', enum: ['true', 'false'] } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }, { name: 'offset', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'Video list' } } } },
    '/api/v1/videos/{id}':         { get: { tags: ['Discovery'], summary: 'Single video metadata + transcript, with the time of each line in segments', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Video detail' }, '404': COMMON_404 } } },

    '/api/v1/stats':               { get: { tags: ['Network'], summary: 'Latest content metrics + 90-snapshot history', responses: { '200': { description: 'Stats payload' }, '503': { description: 'Stats table not initialized' } } } },
    '/api/v1/network':             { get: { tags: ['Network'], summary: 'Live NEAR on-chain state + NEAR market (Explorer + CoinGecko)', responses: { '200': { description: 'Network state snapshot' } } } },

    '/api/v1/repos':               { get: { tags: ['GitHub'], summary: 'Indexed GitHub repos', responses: { '200': { description: 'Repo list with counts' } } } },
    '/api/v1/code':                { get: { tags: ['GitHub'], summary: 'GitHub issues & PRs browser', parameters: [{ name: 'repo', in: 'query', schema: { type: 'string' } }, { name: 'state', in: 'query', schema: { type: 'string' } }, { name: 'type', in: 'query', schema: { type: 'string' } }, { name: 'q', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'GitHub item list' } } } },
    '/api/v1/ecosystem':           { get: { tags: ['Discovery'], summary: 'NEAR ecosystem project catalog', parameters: [{ name: 'category', in: 'query', schema: { type: 'string' } }, { name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'Project list' } } } },

    '/api/v1/sources': {
      get: {
        tags: ['Discovery'], summary: 'One row per content type with count + last_synced',
        responses: { '200': { description: 'Source catalog', content: { 'application/json': { schema: { $ref: '#/components/schemas/SourcesResponse' } } } } },
      },
    },
    '/api/v1/changes': {
      get: {
        tags: ['Discovery'], summary: 'Unified activity stream across all sources',
        parameters: [
          { name: 'days',  in: 'query', schema: { type: 'integer', minimum: 1, maximum: 90, default: 7 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
        ],
        responses: { '200': { description: 'Sorted activity feed with counts subobject', content: { 'application/json': { schema: { $ref: '#/components/schemas/ActivityStream' } } } } },
      },
    },

    '/api/v1/searches/popular': { get: { tags: ['Analytics'], summary: 'Top /search queries', parameters: [{ name: 'window', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 90, default: 7 } }, { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100, default: 20 } }], responses: { '200': { description: 'Query frequency list' } } } },
    '/api/v1/searches/zero':    { get: { tags: ['Analytics'], summary: 'Search queries returning 0 results - content-gap signal', parameters: [{ name: 'window', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 90, default: 7 } }, { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100, default: 20 } }], responses: { '200': { description: 'Distinct zero-result queries' } } } },
    '/api/v1/csp-violations': {
      get: {
        tags: ['Analytics'], summary: 'Aggregated CSP violations grouped by directive',
        parameters: [
          { name: 'window', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 90, default: 7 } },
          { name: 'limit',  in: 'query', schema: { type: 'integer', minimum: 1, maximum: 25, default: 5 }, description: 'Top blocked_uris per directive' },
        ],
        responses: { '200': { description: 'Per-directive aggregates (no IPs, no document URIs)' } },
      },
    },
  },
  components: {
    schemas: {
      CipTldr: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '0042' },
          title: { type: 'string' },
          tldr: { type: ['string', 'null'] },
          cached: { type: 'boolean' },
          generated_at: { type: ['string', 'null'], format: 'date-time' },
          url: { type: 'string', format: 'uri' },
        },
      },
      SourcesResponse: {
        type: 'object',
        properties: {
          total_records: { type: 'integer' },
          source_count: { type: 'integer' },
          sources: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                desc: { type: 'string' },
                count: { type: 'integer' },
                last_synced: { type: ['string', 'null'], format: 'date-time' },
              },
            },
          },
        },
      },
      ActivityStream: {
        type: 'object',
        properties: {
          window_days: { type: 'integer' },
          total: { type: 'integer' },
          counts: {
            type: 'object',
            properties: {
              cip_status_change: { type: 'integer' },
              new_cip: { type: 'integer' },
              new_forum_topic: { type: 'integer' },
              new_blog_post: { type: 'integer' },
              new_release: { type: 'integer' },
              new_radar_item: { type: 'integer' },
            },
          },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string' },
                when: { type: 'string', format: 'date-time' },
                id: { type: 'string' },
                title: { type: 'string' },
                url: { type: ['string', 'null'], format: 'uri' },
                meta: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
      },
    },
  },
} as const;
