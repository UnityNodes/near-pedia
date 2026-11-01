import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { GlossaryBrowser, letterOf, matchesTerm } from '@/components/glossary-browser';
import { GLOSSARY_KINDS } from '@/lib/glossary';
import type { GlossaryEntry } from '@/lib/glossary';
import { getGlossaryMentions, mentionQuery } from '@/lib/glossary-mentions';
import { resetDb, getDb } from '@/lib/db';
import { getCips } from '@/lib/cips';
import { getDocs } from '@/lib/docs';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/components/resources-empty-animation', () => ({ EmptyAnimation: () => null }));

const entry = (over: Partial<GlossaryEntry>): GlossaryEntry => ({
  id: 'x', term: 'X', aliases: [], kind: 'official', blocks: [{ kind: 'p', text: 'A thing.' }], related: [], alsoIn: [], ...over,
});

const ENTRIES: GlossaryEntry[] = [
  entry({ id: 'network-coin-nc', term: 'Network Coin (NC)', aliases: ['NC'], related: [{ id: 'fees', term: 'Fees' }], source: { label: 'Official glossary', url: 'https://docs.example.com/glossary#network-coin-nc' },
    alsoIn: [{ label: 'Reference glossary', url: 'https://docs.example.com/reference/glossary', blocks: [{ kind: 'li', text: 'utility token' }] }] }),
  entry({ id: 'radar', term: 'Radar', kind: 'site', source: { label: 'Radar', url: '/radar' } }),
  entry({ id: 'validator', term: 'Validator' }),
  entry({ id: 'fees', term: 'Fees', blocks: [{ kind: 'p', text: 'Fees.' }, { kind: 'li', text: 'paid in NC' }] }),
];

describe('GlossaryBrowser', () => {
  const html = renderToStaticMarkup(
    <GlossaryBrowser entries={ENTRIES} kinds={GLOSSARY_KINDS} legacyAnchors={{ v: 'validator' }}
      mentions={{ 'network-coin-nc': { query: 'Network Coin', cips: 74, docs: 207 }, radar: { query: 'Radar', cips: 0, docs: 0 } }} />,
  );

  it('groups the terms by letter with a jump list, and gives each term its anchor', () => {
    expect(html).toContain('id="letter-n"');
    expect(html).toContain('href="#letter-r"');
    for (const id of ['network-coin-nc', 'radar', 'validator', 'fees']) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('id="v"');
  });

  it('links related terms in the page, counts that lead to the lists that show them, and the source anchor in a new tab', () => {
    expect(html).toContain('href="#fees"');
    expect(html).toContain('href="/cips?q=Network%20Coin"');
    expect(html).toContain('>74 CIPs<');
    expect(html).toContain('href="/docs?q=Network%20Coin"');
    expect(html).toContain('https://docs.example.com/glossary#network-coin-nc');
    expect(html).toContain('(opens in a new tab)');
    expect(html).not.toContain('/cips?q=Radar');
  });

  it('shows the second wording, the aliases and lists as lists', () => {
    expect(html).toContain('The Reference glossary puts it differently');
    expect(html).toContain('Also called NC');
    expect(html).toMatch(/<ul class="gl-list"><li>paid in NC<\/li><\/ul>/);
  });

  it('says what kind each term is', () => {
    expect(html).toContain('data-kind="site"');
    expect(html).toContain('>This site<');
  });
});

describe('filtering helpers', () => {
  it('files a term under its first letter and anything else under #', () => {
    expect(letterOf('Network Coin')).toBe('N');
    expect(letterOf('gRPC')).toBe('G');
    expect(letterOf('0.10 release')).toBe('#');
  });

  it('matches every word against the name, aliases and both wordings', () => {
    expect(matchesTerm(ENTRIES[0], 'nc')).toBe(true);
    expect(matchesTerm(ENTRIES[0], 'utility token')).toBe(true);
    expect(matchesTerm(ENTRIES[0], 'mediator')).toBe(false);
    expect(matchesTerm(ENTRIES[0], '')).toBe(true);
  });
});

describe('getGlossaryMentions', () => {
  beforeEach(() => { resetDb(); });

  it('counts with the same queries the CIP and docs lists run, so a count equals the list it links to', () => {
    const db = getDb();
    db.prepare('INSERT INTO cips (id, cip_number, title, content_md, status) VALUES (?, ?, ?, ?, ?)').run('0042', 42, 'Traffic pricing', 'Traffic is paid in Network Coin.', 'Draft');
    db.prepare('INSERT INTO cips (id, cip_number, title, content_md, status) VALUES (?, ?, ?, ?, ?)').run('PR-9', null, 'Traffic draft', 'traffic', 'Draft');
    db.prepare('INSERT INTO doc_pages (url, title, content_text, source) VALUES (?, ?, ?, ?)').run('https://docs.example.com/t', 'Traffic', 'Traffic fees', 'yourchain-node');
    db.prepare("INSERT INTO cips_fts(cips_fts) VALUES('rebuild')").run();
    db.prepare("INSERT INTO docs_fts(docs_fts) VALUES('rebuild')").run();
    const m = getGlossaryMentions([{ id: 'traffic', term: 'Traffic' }, { id: 'network-coin-nc', term: 'Network Coin (NC)' }]);
    expect(m.traffic).toEqual({ query: '"Traffic"', cips: getCips({ q: '"Traffic"', kind: 'cip' }).total, docs: getDocs({ q: '"Traffic"' }).total });
    expect(m.traffic.cips).toBe(1);
    expect(m['network-coin-nc'].query).toBe('"Network Coin"');
  });

  it('searches for the name, without its abbreviation, as a phrase of whole words', () => {
    expect(mentionQuery('SDK (Software Development Kit)')).toBe('"SDK"');
    expect(mentionQuery('Local Party')).toBe('"Local Party"');
  });

  it('counts a phrase, not every page that has both words somewhere', () => {
    const db = getDb();
    db.prepare('INSERT INTO doc_pages (url, title, content_text, source) VALUES (?, ?, ?, ?)').run('https://docs.example.com/a', 'A', 'a local party is hosted', 'yourchain-node');
    db.prepare('INSERT INTO doc_pages (url, title, content_text, source) VALUES (?, ?, ?, ?)').run('https://docs.example.com/b', 'B', 'the party was local news', 'yourchain-node');
    db.prepare("INSERT INTO docs_fts(docs_fts) VALUES('rebuild')").run();
    expect(getGlossaryMentions([{ id: 'local-party', term: 'Local Party' }]).docs).toBeUndefined();
    expect(getGlossaryMentions([{ id: 'local-party', term: 'Local Party' }])['local-party'].docs).toBe(1);
  });
});
