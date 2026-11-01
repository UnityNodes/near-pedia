import { describe, it, expect } from 'vitest';
import { cleanDocText, docPageNumbers, docSortsFor, docSourceKind, docTrail, kindCounts, kindSources, parseDocKind, parseDocSort, splitSources } from '@/lib/docs-browse';

describe('docSourceKind', () => {
  it('calls only the publishers we can name official, code what lives in repositories, and the rest ecosystem', () => {
    expect(docSourceKind('yourchain-node')).toBe('official');
    expect(docSourceKind('yourchain-app')).toBe('official');
    expect(docSourceKind('github-code')).toBe('code');
    expect(docSourceKind('npm-package')).toBe('code');
    expect(docSourceKind('partner-docs')).toBe('ecosystem');
    expect(docSourceKind('ecosystem-site')).toBe('ecosystem');
  });

  it('turns a kind into the sources to keep or drop, and the three kinds cover every source once', () => {
    const sources = ['yourchain-node', 'github-code', 'partner-docs', 'yourchain-app', 'npm-package', 'tiny-site'];
    const pick = (k: 'official' | 'ecosystem' | 'code') => {
      const f = kindSources(k)!;
      return sources.filter(s => (f.include ? f.include.includes(s) : true) && !(f.exclude ?? []).includes(s));
    };
    expect([...pick('official'), ...pick('ecosystem'), ...pick('code')].sort()).toEqual([...sources].sort());
    expect(kindSources(null)).toBeUndefined();
  });

  it('sums pages per kind', () => {
    expect(kindCounts([
      { source: 'yourchain-node', count: 10, url: null },
      { source: 'github-code', count: 3, url: null },
      { source: 'partner-docs', count: 2, url: null },
    ])).toEqual({ official: 10, ecosystem: 2, code: 3 });
  });

  it('reads only the kinds it knows from the address', () => {
    expect(parseDocKind('official')).toBe('official');
    expect(parseDocKind('partner')).toBeNull();
    expect(parseDocKind(undefined)).toBeNull();
  });
});

describe('docTrail', () => {
  it('drops the segment that repeats the source and the one that repeats the title, and keeps the last three', () => {
    expect(docTrail('Partner Docs', 'Partner docs', 'Package Manager')).toEqual([]);
    expect(docTrail('Node APIs › Node Packages › Token Standard v2 › node-api-token-v2 › Overview', 'Node docs', 'Overview'))
      .toEqual(['…', 'Node Packages', 'Token Standard v2', 'node-api-token-v2']);
    expect(docTrail('Node API > AsyncAPI > v2/commands/completions', 'Node docs', '/v2/commands/completions')).toEqual(['Node API', 'AsyncAPI']);
    expect(docTrail(null, 'App docs', 'x')).toEqual([]);
  });
});

describe('sources and sorting', () => {
  const sources = [
    { source: 'yourchain-node', count: 1469, url: null },
    { source: 'partner-docs', count: 172, url: null },
    { source: 'tiny-site', count: 1, url: null },
  ];

  it('shows the sources with 20 pages or more, and the one in use even when it is small', () => {
    expect(splitSources(sources).main.map(s => s.source)).toEqual(['yourchain-node', 'partner-docs']);
    expect(splitSources(sources).more.map(s => s.source)).toEqual(['tiny-site']);
    expect(splitSources(sources, 'tiny-site').more).toEqual([]);
  });

  it('offers best match only for a search, and falls back to the first sort for anything else', () => {
    expect(docSortsFor(true).map(s => s.key)).toEqual(['relevance', 'updated']);
    expect(docSortsFor(false).map(s => s.key)).toEqual(['updated', 'title']);
    expect(parseDocSort('title', true)).toBe('relevance');
    expect(parseDocSort('title', false)).toBe('title');
    expect(parseDocSort(undefined, false)).toBe('updated');
  });

  it('numbers the first, last and neighbouring pages with gaps between', () => {
    expect(docPageNumbers(1, 1)).toEqual([1]);
    expect(docPageNumbers(1, 107)).toEqual([1, 2, null, 107]);
    expect(docPageNumbers(50, 107)).toEqual([1, null, 49, 50, 51, null, 107]);
    expect(docPageNumbers(107, 107)).toEqual([1, null, 106, 107]);
    expect(docPageNumbers(3, 4)).toEqual([1, 2, 3, 4]);
  });
});

describe('cleanDocText', () => {
  it('reads markdown and leftover html as the words they wrap', () => {
    expect(cleanDocText('# Package Manager The **Package Manager** tab uses `cpm`.')).toBe('Package Manager The Package Manager tab uses cpm.');
    expect(cleanDocText('See <a href="/x/identity.md">Identity Provider Configuration</a>.</td></tr><tr><td>PostgreS')).toBe('See Identity Provider Configuration . PostgreS');
    expect(cleanDocText('ref="/partner/identity.md">Identity Provider')).toBe('Identity Provider');
    expect(cleanDocText('Read [the guide](https://docs.example.com/x) first <div class="a')).toBe('Read the guide first');
    expect(cleanDocText('C# and #hashtag stay')).toBe('C# and #hashtag stay');
    expect(cleanDocText(null)).toBe('');
  });

  it('keeps code that only looks like markup', () => {
    expect(cleanDocText('alice <- allocateParty "Alice" then submit')).toBe('alice <- allocateParty "Alice" then submit');
    expect(cleanDocText('Map<String, Int> of balances')).toBe('Map<String, Int> of balances');
    expect(cleanDocText('x < 10 are rejected. Use y > 3')).toBe('x < 10 are rejected. Use y > 3');
    expect(cleanDocText('Party Management. "v1", "k2" -> "v2"')).toBe('Party Management. "v1", "k2" -> "v2"');
    expect(cleanDocText('run __main__.py over src/**/*.ts')).toBe('run __main__.py over src/**/*.ts');
    expect(cleanDocText('a __bold__ word and **this**.')).toBe('a bold word and this.');
  });

  it('drops badge images before reading links', () => {
    expect(cleanDocText('[![Go Version](https://img.shields.io/x.svg)](https://golang.org/) A Go SDK')).toBe('A Go SDK');
    expect(cleanDocText('<!-- toc --> Intro')).toBe('Intro');
  });
});
