import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '@/lib/db';
import { htmlText, parseHeadingGlossary, parseQuoteGlossary } from '@/lib/glossary-source';
import { PRIMARY_GLOSSARY_URL, REFERENCE_GLOSSARY_URL, getGlossary, mergeGlossary } from '@/lib/glossary';

const anchor = '<div class="absolute" tabindex="-1"><a href="#x" aria-label="Navigate to header">​<div><svg aria-hidden="true"><path d="M0 0"></path></svg></div></a></div>';
const h3 = (id: string, term: string) => `<h3 class="flex" id="${id}">${anchor}<span class="cursor-pointer">${term}</span></h3>\n`;

const PRIMARY = [
  '<h2 id="a">A</h2>',
  h3('active-record-set-ars', 'Active Record Set (ARS)'),
  '<span data-as="p">The set of records currently active on a node.</span>',
  '<span data-as="p"><strong>Related</strong>: Record, Node</span>',
  '<h2 id="n">N</h2>',
  h3('network-coin-nc', 'Network Coin (NC)'),
  '<span data-as="p">The native utility token of the network.</span>',
  '<span data-as="p"><strong>Related</strong>: Fees</span>',
  h3('choice', 'Choice'),
  '<span data-as="p">An action that can be exercised on a record and can be:</span>',
  '<ul>\n<li><strong>Consuming</strong>: Archives the record</li>\n<li><strong>Non-consuming</strong>: Leaves it active</li>\n</ul>',
  '<span data-as="p"><strong>Related</strong>: Record, Nowhere Term</span>',
  h3('fees', 'Fees'),
  '<span data-as="p">Transaction fees, paid in Network Coin &amp; nothing else.</span>',
  h3('node', 'Node'),
  '<span data-as="p">A server that hosts parties.</span>',
  h3('record', 'Record'),
  '<span data-as="p">An instance of a template on the ledger.</span>',
  h3('wallet', 'Wallet'),
  '<span data-as="p">A user-facing application.</span>',
].join('\n');

const REFERENCE = '<div class="glossary">' + [
  '<span data-as="p">ARS</span><blockquote>\n<span data-as="p"><code>Active Record Set</code></span>\n</blockquote>',
  '<span data-as="p">Active Record Set</span><blockquote>\n<span data-as="p">The records active on the ledger as seen by a node.</span>\n</blockquote>',
  '<span data-as="p">Coin Engine</span><blockquote>\n<span data-as="p">The code implementing Network Coin.</span>\n</blockquote>',
  '<span data-as="p">Name Service (sometimes also called directory service)</span><blockquote>\n<ul>\n<li>allows parties to buy a name</li>\n</ul>\n</blockquote>',
  '<span data-as="p">Network Foundation</span><ul>\n<li>Foundation charged with fostering the network, see <a href="https://example.org/">https://example.org/</a>.</li>\n</ul>',
  '<span data-as="p">NF</span><blockquote>\n<ul>\n<li>abbreviation for <code>Network Foundation</code></li>\n</ul>\n</blockquote>',
  '<span data-as="p">Transfer fees</span><blockquote>\n<span data-as="p">fees</span>\n</blockquote>',
  '<span data-as="p">Old Wallet</span><blockquote>\n<ul>\n<li>provides payment APIs</li>\n</ul>\n</blockquote>',
].join('') + '</div>';

describe('parseHeadingGlossary', () => {
  it('reads each term with its definition, list items and related terms, and drops the permalink glyphs', () => {
    const terms = parseHeadingGlossary(PRIMARY);
    expect(terms.map(t => t.slug)).toEqual(['active-record-set-ars', 'network-coin-nc', 'choice', 'fees', 'node', 'record', 'wallet']);
    const choice = terms.find(t => t.slug === 'choice')!;
    expect(choice.blocks).toEqual([
      { kind: 'p', text: 'An action that can be exercised on a record and can be:' },
      { kind: 'li', text: 'Consuming: Archives the record' },
      { kind: 'li', text: 'Non-consuming: Leaves it active' },
    ]);
    expect(choice.related).toEqual(['Record', 'Nowhere Term']);
    expect(terms.find(t => t.slug === 'fees')!.blocks[0].text).toBe('Transaction fees, paid in Network Coin & nothing else.');
  });

  it('reads the first term when the page starts with it, and nothing from a page with no headings', () => {
    expect(parseHeadingGlossary(h3('fees', 'Fees') + '<span data-as="p">Paid.</span>').map(t => t.slug)).toEqual(['fees']);
    expect(parseHeadingGlossary('<p>moved</p>')).toEqual([]);
  });
});

describe('parseQuoteGlossary', () => {
  it('tells definitions from abbreviations, including an entry whose list sits outside a quote', () => {
    const { terms, aliases } = parseQuoteGlossary(REFERENCE);
    expect(aliases).toEqual([{ alias: 'ARS', target: 'Active Record Set' }, { alias: 'NF', target: 'Network Foundation' }]);
    expect(terms.find(t => t.term === 'Network Foundation')!.blocks[0].text).toBe('Foundation charged with fostering the network, see https://example.org/.');
  });

  it('reads nothing when the glossary block is gone', () => {
    expect(parseQuoteGlossary('<main>404</main>')).toEqual({ terms: [], aliases: [] });
  });
});

describe('mergeGlossary', () => {
  const merged = (prefix: RegExp | null = null) => mergeGlossary({ primary: parseHeadingGlossary(PRIMARY), reference: parseQuoteGlossary(REFERENCE) }, prefix);

  it('keeps the official entry, adds the reference wording beside it, and makes abbreviations and one-word definitions into aliases', () => {
    const g = merged();
    const ars = g.find(e => e.id === 'active-record-set-ars')!;
    expect(ars.kind).toBe('official');
    expect(ars.aliases).toEqual(['ARS']);
    expect(ars.alsoIn).toEqual([{ label: 'Reference glossary', url: REFERENCE_GLOSSARY_URL, blocks: [{ kind: 'p', text: 'The records active on the ledger as seen by a node.' }] }]);
    expect(ars.source).toEqual({ label: 'Official glossary', url: `${PRIMARY_GLOSSARY_URL}#active-record-set-ars` });
    expect(g.find(e => e.id === 'fees')!.aliases).toEqual(['Transfer fees']);
  });

  it('adds reference-only terms with their own anchor and moves "sometimes also called" into an alias', () => {
    const g = merged();
    expect(g.find(e => e.id === 'coin-engine')).toMatchObject({ kind: 'reference', source: { url: REFERENCE_GLOSSARY_URL } });
    expect(g.find(e => e.id === 'name-service')).toMatchObject({ term: 'Name Service', aliases: ['directory service'] });
    expect(g.find(e => e.id === 'network-foundation')).toMatchObject({ kind: 'reference', aliases: ['NF'] });
  });

  it('merges an older name into the official term only when a prefix rule is set', () => {
    expect(merged().some(e => e.term === 'Old Wallet')).toBe(true);
    const g = merged(/^Old\s+(.+)$/);
    expect(g.some(e => e.term === 'Old Wallet')).toBe(false);
    expect(g.find(e => e.id === 'wallet')!.aliases).toContain('Old Wallet');
  });

  it('links related names to entries, drops the ones it cannot find, adds the site terms with an honest kind, and keeps ids unique', () => {
    const g = merged();
    expect(g.find(e => e.id === 'choice')!.related).toEqual([{ id: 'record', term: 'Record' }]);
    expect(g.find(e => e.id === 'tvl')!.kind).toBe('market');
    expect(g.find(e => e.id === 'radar')!.kind).toBe('site');
    const ids = g.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('falls back to the hand-written terms when the glossary page is not held', () => {
    const g = mergeGlossary({ primary: [], reference: { terms: [], aliases: [] } });
    expect(g.map(e => e.id)).toEqual(expect.arrayContaining(['validator', 'mainnet', 'testnet', 'improvement-proposal', 'tvl', 'radar']));
  });
});

describe('getGlossary', () => {
  beforeEach(() => { resetDb(); });

  it('builds from the two synced pages and says when each changed upstream', () => {
    const ins = getDb().prepare('INSERT INTO doc_pages (url, title, content_html, source, last_modified, synced_at) VALUES (?, ?, ?, ?, ?, ?)');
    ins.run(PRIMARY_GLOSSARY_URL, 'Glossary', PRIMARY, 'yourchain-node', '2026-06-10T17:04:40.306Z', '2026-06-10T17:04:40.306Z');
    ins.run(REFERENCE_GLOSSARY_URL, 'Glossary', REFERENCE, 'yourchain-node', '2026-06-22T14:22:39.588Z', '2026-06-22T14:22:39.588Z');
    const g = getGlossary();
    expect(g.sources.map(s => [s.label, s.held, s.terms])).toEqual([['Official glossary', true, 7], ['Reference glossary', true, 6]]);
    expect(g.sources.map(s => s.parsed === s.headings)).toEqual([true, true]);
  });

  it('says a page is held but not parsed when its markup changed', () => {
    getDb().prepare('INSERT INTO doc_pages (url, title, content_html, source) VALUES (?, ?, ?, ?)').run(PRIMARY_GLOSSARY_URL, 'Glossary', '<h3 id="x">X</h3><div>new layout</div>', 'yourchain-node');
    expect(getGlossary().sources[0]).toMatchObject({ held: true, terms: 0, parsed: 0, headings: 1 });
  });

  it('still answers with the fallback when neither page is held', () => {
    const g = getGlossary();
    expect(g.sources.every(s => !s.held)).toBe(true);
    expect(g.entries.length).toBeGreaterThan(3);
  });
});

describe('htmlText', () => {
  it('joins inline markup without stray spaces, decodes entities, and keeps an impossible reference as text', () => {
    expect(htmlText('<strong>Consuming</strong>: archives &amp; <code>x</code>.')).toBe('Consuming: archives & x.');
    expect(htmlText('a &mdash; b&rsquo;s')).toBe('a — b’s');
    expect(htmlText('x &#1114112; y')).toBe('x &#1114112; y');
  });
});
