import { describe, it, expect } from 'vitest';
import { breadcrumbList, collectionPage, techArticle, dataset, jsonLdScript } from '@/lib/jsonld';

// Derived from the real config, not hardcoded - a literal here silently rotted
// through a rename and asserted the old domain.
import { SITE as SITE_CONFIG } from '@/lib/site.config';

const SITE = SITE_CONFIG.url;

function isSerializable(obj: unknown): boolean {
  try {
    const s = JSON.stringify(obj);
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

describe('breadcrumbList', () => {
  it('builds a Schema.org BreadcrumbList', () => {
    const b = breadcrumbList([
      { name: 'Home', path: '/' },
      { name: 'CIPs', path: '/cips' },
      { name: 'CIP-0042', path: '/cips/0042' },
    ]);
    expect(b['@context']).toBe('https://schema.org');
    expect(b['@type']).toBe('BreadcrumbList');
    expect(b.itemListElement).toHaveLength(3);
    expect(b.itemListElement[0]).toEqual({
      '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/`,
    });
    expect(b.itemListElement[2].item).toBe(`${SITE}/cips/0042`);
  });

  it('handles empty input without throwing', () => {
    const b = breadcrumbList([]);
    expect(b.itemListElement).toEqual([]);
  });

  it('positions are 1-indexed and contiguous', () => {
    const b = breadcrumbList([
      { name: 'A', path: '/a' },
      { name: 'B', path: '/b' },
      { name: 'C', path: '/c' },
    ]);
    expect(b.itemListElement.map(it => it.position)).toEqual([1, 2, 3]);
  });

  it('is JSON-serializable round-trip', () => {
    const b = breadcrumbList([{ name: 'X', path: '/x' }]);
    expect(isSerializable(b)).toBe(true);
  });
});

describe('collectionPage', () => {
  it('builds a CollectionPage with publisher + isPartOf', () => {
    const c = collectionPage({
      name: 'YOURPEDIA for Validators',
      description: 'Operational hub.',
      path: '/validators',
    });
    expect(c['@type']).toBe('CollectionPage');
    expect(c.url).toBe(`${SITE}/validators`);
    expect(c.publisher).toEqual({ '@type': 'Organization', name: SITE_CONFIG.name, url: SITE });
    expect(c.isPartOf).toEqual({ '@type': 'WebSite', name: SITE_CONFIG.name, url: SITE });
  });

  it('omits mainEntity when itemCount is undefined', () => {
    const c = collectionPage({ name: 'x', description: 'y', path: '/z' });
    expect(c).not.toHaveProperty('mainEntity');
  });

  it('includes ItemList when itemCount is set', () => {
    const c = collectionPage({ name: 'x', description: 'y', path: '/z', itemCount: 42 });
    expect((c as unknown as { mainEntity: { '@type': string; numberOfItems: number } }).mainEntity).toEqual({
      '@type': 'ItemList', numberOfItems: 42,
    });
  });

  it('itemCount=0 still produces an ItemList (zero is meaningful)', () => {
    const c = collectionPage({ name: 'x', description: 'y', path: '/z', itemCount: 0 });
    expect((c as unknown as { mainEntity?: { numberOfItems: number } }).mainEntity).toBeDefined();
    expect((c as unknown as { mainEntity: { numberOfItems: number } }).mainEntity.numberOfItems).toBe(0);
  });
});

describe('techArticle', () => {
  it('builds a TechArticle with required fields', () => {
    const a = techArticle({
      headline: 'CIP-42 explained',
      description: 'A deep dive',
      path: '/cips/0042',
    });
    expect(a['@type']).toBe('TechArticle');
    expect(a.headline).toBe('CIP-42 explained');
    expect(a.url).toBe(`${SITE}/cips/0042`);
  });

  it('omits optional fields when not provided', () => {
    const a = techArticle({ headline: 'h', description: 'd', path: '/p' });
    expect(a).not.toHaveProperty('datePublished');
    expect(a).not.toHaveProperty('dateModified');
    expect(a).not.toHaveProperty('author');
    expect(a).not.toHaveProperty('articleSection');
    expect(a).not.toHaveProperty('keywords');
  });

  it('treats null author/dates the same as undefined (omit)', () => {
    const a = techArticle({
      headline: 'h', description: 'd', path: '/p',
      datePublished: null, dateModified: null, author: null,
    });
    expect(a).not.toHaveProperty('datePublished');
    expect(a).not.toHaveProperty('dateModified');
    expect(a).not.toHaveProperty('author');
  });

  it('wraps the author in Person when provided', () => {
    const a = techArticle({ headline: 'h', description: 'd', path: '/p', author: 'Alice' });
    expect((a as unknown as { author: { '@type': string; name: string } }).author).toEqual({
      '@type': 'Person', name: 'Alice',
    });
  });

  it('joins keywords with comma+space and filters empty strings', () => {
    const a = techArticle({
      headline: 'h', description: 'd', path: '/p',
      keywords: ['yourchain', '', 'sdk', 'governance'],
    });
    expect((a as unknown as { keywords: string }).keywords).toBe('yourchain, sdk, governance');
  });
});

describe('dataset', () => {
  it('builds a Dataset with publisher', () => {
    const d = dataset({
      name: 'YOURPEDIA Stats',
      description: 'Time-series',
      path: '/stats',
    });
    expect(d['@type']).toBe('Dataset');
    expect(d.url).toBe(`${SITE}/stats`);
    expect(d.publisher).toEqual({ '@type': 'Organization', name: SITE_CONFIG.name, url: SITE });
  });

  it('emits a DataDownload distribution when apiPath set', () => {
    const d = dataset({
      name: 'x', description: 'y', path: '/p', apiPath: '/api/v1/stats',
    });
    expect((d as unknown as { distribution: Array<{ '@type': string; encodingFormat: string; contentUrl: string }> }).distribution).toEqual([
      { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE}/api/v1/stats` },
    ]);
  });

  it('includes dateModified when supplied', () => {
    const d = dataset({
      name: 'x', description: 'y', path: '/p', modified: '2026-06-04T00:00:00Z',
    });
    expect((d as unknown as { dateModified: string }).dateModified).toBe('2026-06-04T00:00:00Z');
  });

  it('omits distribution when apiPath not supplied', () => {
    const d = dataset({ name: 'x', description: 'y', path: '/p' });
    expect(d).not.toHaveProperty('distribution');
  });
});

describe('jsonLdScript', () => {
  it('wraps payload as ld+json script props', () => {
    const s = jsonLdScript({ '@type': 'Thing' });
    expect(s.type).toBe('application/ld+json');
    expect(s.dangerouslySetInnerHTML.__html).toBe('{"@type":"Thing"}');
  });

  it('escape-safe: serializes any payload (no thrown errors)', () => {
    expect(() => jsonLdScript({ x: 'has "quotes"', y: ['a', 'b'] })).not.toThrow();
  });
});

describe('schema.org payload shape (cross-builder)', () => {
  it.each([
    ['breadcrumb', () => breadcrumbList([{ name: 'h', path: '/' }])],
    ['collection', () => collectionPage({ name: 'n', description: 'd', path: '/p' })],
    ['article', () => techArticle({ headline: 'h', description: 'd', path: '/p' })],
    ['dataset', () => dataset({ name: 'n', description: 'd', path: '/p' })],
  ])('%s carries @context = https://schema.org', (_, build) => {
    const obj = build();
    expect((obj as { '@context': string })['@context']).toBe('https://schema.org');
  });

  it.each([
    ['breadcrumb', () => breadcrumbList([{ name: 'h', path: '/' }])],
    ['collection', () => collectionPage({ name: 'n', description: 'd', path: '/p' })],
    ['article', () => techArticle({ headline: 'h', description: 'd', path: '/p' })],
    ['dataset', () => dataset({ name: 'n', description: 'd', path: '/p' })],
  ])('%s is JSON-serializable round-trip', (_, build) => {
    expect(isSerializable(build())).toBe(true);
  });

  it('every builder produces URL prefixed with the canonical site URL', () => {
    const builders = [
      collectionPage({ name: 'n', description: 'd', path: '/p' }),
      techArticle({ headline: 'h', description: 'd', path: '/p' }),
      dataset({ name: 'n', description: 'd', path: '/p' }),
    ];
    for (const obj of builders) {
      expect((obj as { url: string }).url.startsWith(SITE)).toBe(true);
    }
  });
});
