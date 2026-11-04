import { describe, expect, it } from 'vitest';
import { MAX_RENDER_CHARS, parseStub, renderOperation } from '@/lib/openapi-pages';
import { diffPages, expandOpenApiPages, parseLlmsFull } from '@/lib/near-docs';

const spec = {
  paths: {
    '/block': {
      post: {
        summary: 'Block',
        description: 'Returns block details for given height or hash',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Req' } } } },
        responses: { '200': { description: 'The block', content: { 'application/json': { schema: { $ref: '#/components/schemas/Res' } } } } },
      },
    },
    '/v1/models/{id}': {
      get: {
        description: 'One model.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Model id' },
          { name: 'verbose', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: { '404': { description: 'No such model' } },
      },
    },
  },
  components: {
    schemas: {
      Req: {
        type: 'object',
        required: ['method', 'params'],
        properties: {
          method: { type: 'string', enum: ['block'] },
          params: { $ref: '#/components/schemas/BlockRequest' },
        },
      },
      BlockRequest: {
        oneOf: [
          { title: 'by id', type: 'object', required: ['block_id'], properties: { block_id: { type: 'string', description: 'Height or hash' } } },
          { title: 'by finality', type: 'object', required: ['finality'], properties: { finality: { $ref: '#/components/schemas/Finality' } } },
        ],
      },
      Finality: { type: 'string', enum: ['optimistic', 'near-final', 'final'] },
      Res: { type: 'object', properties: { result: { type: 'object', properties: { header: { type: 'object', properties: { height: { type: 'integer', format: 'uint64' } } } } } } },
      Loop: { type: 'object', properties: { next: { $ref: '#/components/schemas/Loop' } } },
    },
  },
};

describe('reading a Mintlify OpenAPI page', () => {
  it('recognises the one-line spec reference Mintlify puts where the page body would be', () => {
    expect(parseStub('/openapi.json post /block\nReturns block details for given height or hash')).toEqual({ spec: '/openapi.json', method: 'post', path: '/block', rest: 'Returns block details for given height or hash' });
    expect(parseStub('https://1click.chaindefuser.com/docs/v0/openapi.yaml get /v0/tokens')).toEqual({ spec: 'https://1click.chaindefuser.com/docs/v0/openapi.yaml', method: 'get', path: '/v0/tokens', rest: '' });
    expect(parseStub('A meta transaction lets a relayer pay gas.')).toBeNull();
  });

  it('writes out the request, its variants and enums, and the response, from the spec', () => {
    const text = renderOperation(spec, 'post', '/block')!;
    expect(text).toContain('POST /block');
    expect(text).toContain('- method (string, required): one of block');
    expect(text).toContain('- params (required): one of');
    expect(text).toContain('by id:');
    expect(text).toContain('- block_id (string, required): Height or hash');
    expect(text).toContain('- finality (string, required): one of optimistic, near-final, final');
    expect(text).toContain('200: The block');
    expect(text).toContain('- height (integer, uint64)');
  });

  it('lists path and query parameters, and survives a schema that refers to itself', () => {
    const text = renderOperation(spec, 'get', '/v1/models/{id}')!;
    expect(text).toContain('- id (path, string, required): Model id');
    expect(text).toContain('- verbose (query, boolean)');
    expect(text).toContain('404: No such model');
    const loop = { ...spec, paths: { '/x': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Loop' } } } } } } } } };
    expect(renderOperation(loop, 'get', '/x')!.length).toBeLessThanOrEqual(MAX_RENDER_CHARS);
    expect(renderOperation(spec, 'get', '/missing')).toBeNull();
  });
});

describe('keeping a rendered page readable', () => {
  it('states a long shared description once, without its examples, and keeps the request before the response', () => {
    const account = { type: 'string', description: 'NEAR Account Identifier. A valid account id.\n\n## Examples\n```\nlet a = 1;\n```' };
    const shared = {
      paths: { '/tx': { post: {
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { sender: account, receiver: account } } } } },
        responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties: { signer: account } } } } } },
      } } },
    };
    const text = renderOperation(shared, 'post', '/tx')!;
    expect(text).toContain('- sender (string): NEAR Account Identifier. A valid account id.');
    expect(text).toContain('- receiver (string)\n');
    expect(text).not.toContain('Examples');
    expect(text.indexOf('Request body')).toBeLessThan(text.indexOf('Responses'));
  });
});

describe('filling the stub pages of a docs feed', () => {
  const feed = '# Block\nSource: https://docs.near.org/api-reference/block\n\n/openapi.json post /block\nReturns block details for given height or hash\n\n# Gas\nSource: https://docs.near.org/gas\n\nGas is what a call burns.\n';

  it('expands a stub page from its spec, once per spec, and leaves the others alone', async () => {
    const loaded: string[] = [];
    const { pages, problems } = await expandOpenApiPages(parseLlmsFull(feed), 'https://docs.near.org', async (url) => { loaded.push(url); return spec; });
    expect(loaded).toEqual(['https://docs.near.org/openapi.json']);
    expect(problems).toEqual([]);
    expect(pages[0].content_text).toContain('- block_id (string, required): Height or hash');
    expect(pages[0].stub_hash).toBe(parseLlmsFull(feed)[0].content_hash);
    expect(pages[1]).toEqual(parseLlmsFull(feed)[1]);
  });

  it('keeps the stub and names the problem when the spec cannot be read', async () => {
    const { pages, problems } = await expandOpenApiPages(parseLlmsFull(feed), 'https://docs.near.org', async () => null);
    expect(pages[0]).toEqual(parseLlmsFull(feed)[0]);
    expect(problems).toEqual(['https://docs.near.org/openapi.json: could not be read']);
  });

  it('records no rewrite the first time a stored stub is filled in', async () => {
    const stub = parseLlmsFull(feed);
    const { pages } = await expandOpenApiPages(stub, 'https://docs.near.org', async () => spec);
    const stored = stub.map((p) => ({ url: p.url, title: p.title, content_hash: p.content_hash }));
    expect(diffPages(stored, pages)).toEqual([]);
  });
});
