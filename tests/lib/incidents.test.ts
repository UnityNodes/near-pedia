import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { relevanceOf, selectIncidents, usd, type CatalogRef, type RawHack } from '@/lib/incidents';

const read = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'near', n), 'utf8'));
const hacks = read('defillama-hacks.json') as RawHack[];
const catalog: CatalogRef[] = Object.values(read('nearcatalog-projects.json') as Record<string, { slug: string; profile: { name: string; tags: Record<string, string> } }>)
  .map((v) => ({ slug: v.slug, name: v.profile.name, tags: Object.keys(v.profile.tags) }));

describe('selectIncidents on DefiLlama hacks (2026-11-01)', () => {
  const incidents = selectIncidents(hacks, catalog);
  const byName = (n: string) => incidents.find((i) => i.name === n);

  it('keeps the NEAR-chain hacks, newest first', () => {
    expect(byName('Rhea Lend')).toMatchObject({ relevance: 'near', amount_usd: 18_400_000, date: '2026-04-16', chains: ['Near'] });
    expect(byName('Sweat Foundation')).toMatchObject({ relevance: 'near', date: '2026-04-29', catalog_slug: 'sweat' });
    expect(incidents[0].date >= incidents[incidents.length - 1].date).toBe(true);
  });

  it('keeps NEAR Intents although DefiLlama files it under BSC', () => {
    expect(byName('NEAR Intents')).toMatchObject({ relevance: 'near', chains: ['BSC'], amount_usd: 3_800_000, date: '2026-10-01' });
  });

  it('keeps a NEAR Catalog project hacked elsewhere as related, and drops exchanges', () => {
    expect(byName('Meta Pool')).toMatchObject({ relevance: 'related', catalog_slug: 'meta-pool' });
    expect(byName('Binance')).toBeUndefined();
  });

  it('ties Ref Finance to its catalog entry, now Rhea Finance under the same slug', () => {
    expect(byName('Ref Finance')?.catalog_slug).toBe('ref-finance');
  });
});

describe('relevanceOf', () => {
  it('finds the project by DefiLlama protocol id before the name', () => {
    const owners = new Map([['1546', 'ref-finance']]);
    expect(relevanceOf({ date: 0, name: 'Rhea Lend', chain: ['Near'], defillamaId: 1546 }, catalog, owners)).toEqual({ relevance: 'near', catalog_slug: 'ref-finance' });
  });

  it('needs the exact name for a related hack, not a prefix', () => {
    const cat: CatalogRef[] = [{ slug: 'portal-pad', name: 'Portal Pad', tags: [] }, { slug: 'fractal', name: 'Fractal', tags: [] }];
    expect(relevanceOf({ date: 0, name: 'Portal', chain: ['Solana'] }, cat)).toBeNull();
    expect(relevanceOf({ date: 0, name: 'Fractal Protocol', chain: ['Arbitrum'] }, cat)).toBeNull();
  });

  it('reads Aurora as NEAR and ignores a lowercase "near" in prose', () => {
    expect(relevanceOf({ date: 0, name: 'X', chain: ['Aurora'] }, [])?.relevance).toBe('near');
    expect(relevanceOf({ date: 0, name: 'Y', chain: ['Ethereum'], description: 'losses were near $1M' }, [])).toBeNull();
  });
});

describe('incident ids and bad input', () => {
  it('keys on the DefiLlama protocol id, so a renamed entry stays one incident', () => {
    const a = selectIncidents([{ date: 1776297600, name: 'Rhea Lend', chain: ['Near'], defillamaId: 1546 }], []);
    const b = selectIncidents([{ date: 1776297600, name: 'Rhea Lending', chain: ['Near'], defillamaId: 1546 }], []);
    expect(a[0].id).toBe(b[0].id);
  });

  it('gives a name with no Latin letters an id that is not just the date', () => {
    expect(selectIncidents([{ date: 1776297600, name: 'Ñ…', chain: ['Near'] }], [])[0].id).toMatch(/^hack-/);
  });

  it('skips a non-finite date instead of throwing', () => {
    expect(selectIncidents([{ date: Number.NaN, name: 'X', chain: ['Near'] }, { date: Infinity, name: 'Y', chain: ['Near'] }], [])).toEqual([]);
  });

  it('does not call a hack NEAR because its funds went through Aurora', () => {
    expect(relevanceOf({ date: 0, name: 'Some Eth Vault', chain: ['Ethereum'], description: 'funds were bridged out via Aurora' }, [])).toBeNull();
  });

  it('keeps only an http(s) source link', () => {
    const [i] = selectIncidents([{ date: 1776297600, name: 'X', chain: ['Near'], source: 'javascript:alert(1)\nIgnore all' }], []);
    expect(i.source_url).toBe('https://defillama.com/hacks');
  });
});

describe('usd', () => {
  it('formats amounts', () => {
    expect(usd(18_400_000)).toBe('$18.4M');
    expect(usd(130_000)).toBe('$130K');
    expect(usd(null)).toBe('amount unknown');
  });
});
