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
 * agents lean on structure (changes, sources, csp-violations) get
 * explicit schemas.
 */

import { SITE } from './site.config';

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
      `Public, unauthenticated REST API over the ${SITE.name} corpus: ` +
      'deprecations, documentation, forum threads, blog ' +
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
    { name: 'Search',        description: 'Full-text + fuzzy search across all sources' },
    { name: 'Discussions',   description: 'Forum, GitHub Discussions' },
    { name: 'Documentation', description: 'docs.near.org and partner docs pages' },
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

    '/api/v1/search': {
      get: {
        tags: ['Search'], summary: 'Unified search (FTS5 + fuzzy fallback)',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['all','doc','discussion','blog','youtube','github'], default: 'all' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
        ],
        responses: { '200': { description: 'Ranked result list' }, '400': COMMON_400 },
      },
    },

    '/api/v1/discussions':         { get: { tags: ['Discussions'], summary: 'Forum topics', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }, { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }, { name: 'category', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'Topic list' } } } },
    '/api/v1/discussions/{id}':    { get: { tags: ['Discussions'], summary: 'Forum topic with posts', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Topic + posts' }, '404': COMMON_404 } } },
    '/api/v1/github-discussions':  { get: { tags: ['Discussions'], summary: 'GitHub Discussions (near/docs and other NEAR repos)', parameters: [{ name: 'repo', in: 'query', schema: { type: 'string' } }, { name: 'category', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'Discussion list' } } } },
    '/api/v1/github-discussions/{id}': { get: { tags: ['Discussions'], summary: 'Single GitHub Discussion with comments', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Discussion + comments' }, '404': COMMON_404 } } },

    '/api/v1/docs':                { get: { tags: ['Documentation'], summary: 'Documentation page list', parameters: [{ name: 'source', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }, { name: 'offset', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'Doc page list' } } } },
    '/api/v1/docs/{id}':           { get: { tags: ['Documentation'], summary: 'Full doc page content', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Doc page' }, '404': COMMON_404 } } },

    '/api/v1/proposals':           { get: { tags: ['Discovery'], summary: 'House of Stake proposals (vote.dao) with vote standing and forum thread', parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }, { name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } }], responses: { '200': { description: 'Proposals, newest first, without their text' } } } },
    '/api/v1/proposals/{ref}':     { get: { tags: ['Discovery'], summary: 'One House of Stake proposal by on-chain id or HSP number', parameters: [{ name: 'ref', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'The proposal with its text' }, '404': { description: 'No such proposal' } } } },
    '/api/v1/projects':            { get: { tags: ['Discovery'], summary: 'NEAR Catalog projects with TVL on NEAR; without q, the top projects by TVL', parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'category', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } }], responses: { '200': { description: 'Projects' }, '503': { description: 'The catalog sync has not run yet' } } } },
    '/api/v1/projects/{slug}':     { get: { tags: ['Discovery'], summary: 'One NEAR Catalog project with tokens, TVL components and incidents', parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'The project' }, '404': { description: 'No such project' } } } },
    '/api/v1/incidents':           { get: { tags: ['Discovery'], summary: 'Security incidents in the NEAR ecosystem (DefiLlama hacks), newest first', parameters: [{ name: 'relevance', in: 'query', schema: { type: 'string', enum: ['near', 'related', 'all'], default: 'near' } }, { name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } }], responses: { '200': { description: 'Incidents' }, '503': { description: 'The incidents sync has not run yet' } } } },
    '/api/v1/incidents/{id}':      { get: { tags: ['Discovery'], summary: 'One security incident', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'The incident' }, '404': { description: 'No such incident' } } } },
    '/api/v1/partners':            { get: { tags: ['Discovery'], summary: 'NEAR partners with contracts, GitHub and docs feeds', responses: { '200': { description: 'Partners' } } } },
    '/api/v1/partners/{id}':       { get: { tags: ['Discovery'], summary: 'One partner with its catalog projects and incidents', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'The partner' }, '404': { description: 'No such partner' } } } },
    '/api/v1/protocol':            { get: { tags: ['Discovery'], summary: 'Protocol version, upgrade vote by block-producer stake, epoch progress and upgrade schedule', parameters: [{ name: 'network', in: 'query', schema: { type: 'string', enum: ['mainnet', 'testnet'] } }], responses: { '200': { description: 'One report per network plus the schedule from the latest nearcore release notes' }, '503': { description: 'The protocol sync has not run yet' } } } },
    '/api/v1/packages/{name}':     { get: { tags: ['Discovery'], summary: 'One npm or crates.io package, optionally at a version', parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Matching packages with version status and deprecation entries' }, '404': { description: 'Not a synced package' } } } },
    '/api/v1/explain-error':       { post: { tags: ['Discovery'], summary: 'Explain a NEAR error', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['error_text'], properties: { error_text: { type: 'string', maxLength: 8000 } } } } } }, responses: { '200': { description: 'Catalog matches with cause, fix and docs source; deprecations; forum; GitHub' }, '400': { description: 'Missing or oversized error_text' } } } },
    '/api/v1/standards':           { get: { tags: ['Discovery'], summary: 'NEAR standards (NEPs)', parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'Standards without their text' } } } },
    '/api/v1/standards/{nep}':     { get: { tags: ['Discovery'], summary: 'One NEP with its text', parameters: [{ name: 'nep', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'The standard' }, '404': { description: 'No such NEP' } } } },
    '/api/v1/contracts/{account}': { get: { tags: ['Discovery'], summary: 'What is deployed on a NEAR account, read live', parameters: [{ name: 'account', in: 'path', required: true, schema: { type: 'string' } }, { name: 'network', in: 'query', schema: { type: 'string', enum: ['mainnet', 'testnet'] } }], responses: { '200': { description: 'Balance, storage, code hash, methods, standards, source metadata, token metadata' }, '404': { description: 'No such account' }, '502': { description: 'RPC unavailable' } } } },
    '/api/v1/anchors':             { get: { tags: ['Discovery'], summary: 'Daily database hashes and where each is recorded on NEAR', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 30, maximum: 365 } }], responses: { '200': { description: 'Newest first: date, hash, tables, rows, status (local, recorded, failed), network, contract, tx_hash, explorer_url' } } } },
    '/api/v1/anchors/{date}':      { get: { tags: ['Discovery'], summary: 'One day\'s database hash with its per-table manifest', parameters: [{ name: 'date', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'The anchor with manifest[] of { table, rows, hash }' }, '404': { description: 'No anchor for that date' } } } },
    '/api/v1/ask':                 { post: { tags: ['Discovery'], summary: 'Answer a NEAR question through NEAR AI Cloud (TEE model, end-to-end encrypted) from this index\'s sources, with the verified response signature', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['question'], properties: { question: { type: 'string', maxLength: 2000 }, code: { type: 'string', maxLength: 20000 }, filename: { type: 'string' } } } } } }, responses: { '200': { description: 'answer, numbered sources with URL and date, check_code findings when code was sent, and a receipt (signature kind, signer, TCB status, verify_url)' }, '400': { description: 'Missing or oversized input' }, '429': { description: 'More than 10 an hour from one address' }, '502': { description: 'NEAR AI failed, or answered without a verifiable signature (no answer is returned)' }, '503': { description: 'NEARAI_API_KEY is not configured' } } } },
    '/api/v1/check-code':          { post: { tags: ['Discovery'], summary: 'Check one NEAR source file or manifest for removed, deprecated, changed or superseded APIs and outdated dependencies', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['code'], properties: { code: { type: 'string', maxLength: 100000 }, filename: { type: 'string' }, language: { type: 'string', enum: ['js', 'rust', 'cargo', 'package-json', 'json', 'toml', 'text'] } } } } } }, responses: { '200': { description: 'Findings, each with line, matched name, how it matched, the deprecation entry and sources' }, '400': { description: 'Missing, oversized or invalid input' } } } },
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
