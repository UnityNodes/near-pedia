import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { announcedUrls, diffPages, parseLlmsFull, singleDocPage } from '@/lib/near-docs';

const sample = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'near', 'docs-llms-full-sample.txt'), 'utf8');

describe('parseLlmsFull on the docs.near.org feed (snapshot 2026-11-01)', () => {
  const pages = parseLlmsFull(sample);

  it('takes one page per Mintlify header', () => {
    expect(pages.length).toBe(announcedUrls(sample).length);
    expect(pages.length).toBeGreaterThanOrEqual(5);
  });

  it('keeps the canonical URL, the title and a body without the header lines', () => {
    const block = pages.find((p) => p.url === 'https://docs.near.org/api-reference/post-block');
    expect(block?.title).toBe('Post block');
    expect(block?.content_text.startsWith('/openapi.json post /block')).toBe(true);
    expect(block?.content_text).not.toContain('Source: https://docs.near.org');
    expect(block?.breadcrumb).toBe('api reference › post block');
  });

  it('keeps the deprecation marker the RPC reference carries in its body', () => {
    const commit = pages.find((p) => p.url.endsWith('/post-broadcast_tx_commit'));
    expect(commit?.content_text).toMatch(/^\[Deprecated\]/m);
  });
});

describe('parseLlmsFull header edge cases', () => {
  it('keeps a page whose title line is empty, as the home page is, and names it from the URL', () => {
    const text = '# Intro\nSource: https://docs.near.org/intro\n\nHello.\n\n\n# \nSource: https://docs.near.org/index\n\n[MCP Ready](https://docs.near.org/mcp)\n';
    const pages = parseLlmsFull(text);
    expect(pages.map((p) => p.url)).toEqual(['https://docs.near.org/intro', 'https://docs.near.org/index']);
    expect(pages[1].title).toBe('NEAR Docs');
  });

  it('does not split a page at a heading that is not followed by a Source line', () => {
    const text = '# Page\nSource: https://docs.near.org/a\n\n# Inner heading\nbody\n';
    const pages = parseLlmsFull(text);
    expect(pages).toHaveLength(1);
    expect(pages[0].content_text).toContain('# Inner heading');
  });

  it('ignores a Source line that points off the docs host', () => {
    expect(parseLlmsFull('# X\nSource: https://example.org/x\n\nbody\n')).toEqual([]);
  });
});

describe('diffPages', () => {
  const page = (url: string, body: string) => parseLlmsFull(`# T\nSource: ${url}\n\n${body}\n`)[0];

  it('reports nothing on a first run, when nothing is stored yet', () => {
    expect(diffPages([], [page('https://docs.near.org/a', 'x')])).toEqual([]);
  });

  it('reports an added and a changed page, and leaves removals to the prune', () => {
    const a = page('https://docs.near.org/a', 'one');
    const b = page('https://docs.near.org/b', 'two');
    const stored = [
      { url: a.url, title: 'T', content_hash: a.content_hash },
      { url: b.url, title: 'T', content_hash: 'stale' },
      { url: 'https://docs.near.org/gone', title: 'Gone', content_hash: 'x' },
    ];
    const fresh = [a, b, page('https://docs.near.org/new', 'three')];
    expect(diffPages(stored, fresh).map((c) => `${c.kind} ${c.url}`).sort()).toEqual([
      'doc_added https://docs.near.org/new',
      'doc_changed https://docs.near.org/b',
    ]);
  });

  it('does not call a page changed when the stored row predates hashing', () => {
    const a = page('https://docs.near.org/a', 'one');
    expect(diffPages([{ url: a.url, title: 'T', content_hash: null }], [a])).toEqual([]);
  });
});

describe('singleDocPage', () => {
  it('reads a one-document llms.txt as one page titled by its first heading', () => {
    const pg = singleDocPage('# NEAR Intents Agent API\n\n> Backend HTTP API for agents.\n\n## Conventions\n\nUse X-API-Key.', 'https://api.agentsonintents.com/llms.txt');
    expect(pg?.url).toBe('https://api.agentsonintents.com/llms.txt');
    expect(pg?.title).toBe('NEAR Intents Agent API');
    expect(pg?.content_text).toContain('## Conventions');
    expect(pg?.content_text).not.toContain('# NEAR Intents Agent API');
    expect(pg?.excerpt).toBe('Backend HTTP API for agents. Conventions Use X-API-Key.');
  });

  it('returns null for an empty document', () => {
    expect(singleDocPage('# Title only\n', 'https://example.org/llms.txt')).toBeNull();
    expect(singleDocPage('   ', 'https://example.org/llms.txt')).toBeNull();
  });
});
