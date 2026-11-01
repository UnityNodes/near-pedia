import { getDb } from './db';
import { parseHeadingGlossary, parseQuoteGlossary } from './glossary-source';
import type { DefinitionBlock, ParsedAlias, ParsedTerm } from './glossary-source';

export type GlossaryKind = 'official' | 'reference' | 'docs' | 'market' | 'site';

export const GLOSSARY_KINDS: Record<GlossaryKind, { label: string; hint: string }> = {
  official: { label: 'Official glossary', hint: 'Quoted from the network’s official glossary.' },
  reference: { label: 'Reference glossary', hint: 'Quoted from the second glossary in the reference docs.' },
  docs: { label: 'Official docs', hint: 'Defined in official material outside the two glossaries.' },
  market: { label: 'Market term', hint: 'A general market figure, defined here with the source of the example.' },
  site: { label: 'This site', hint: 'A feature of this site, not the network’s vocabulary.' },
};

export interface GlossaryLink {
  label: string;
  url: string;
}

export interface GlossaryEntry {
  id: string;
  term: string;
  aliases: string[];
  kind: GlossaryKind;
  blocks: DefinitionBlock[];
  related: { id: string; term: string }[];
  source?: GlossaryLink;
  alsoIn: (GlossaryLink & { blocks: DefinitionBlock[] })[];
}

export interface Glossary {
  stamp: string;
  entries: GlossaryEntry[];
  sources: { label: string; url: string; held: boolean; updated: string | null; terms: number; parsed: number; headings: number }[];
}

export const PRIMARY_GLOSSARY_URL = 'https://docs.example.com/glossary';
export const REFERENCE_GLOSSARY_URL = 'https://docs.example.com/reference/glossary';

export const LEGACY_ANCHORS: Record<string, string> = {};

export const OLDER_NAME_PREFIX: RegExp | null = null;

type OwnTerm = Omit<GlossaryEntry, 'related' | 'alsoIn' | 'aliases'> & { aliases?: string[]; related?: string[] };

const OWN_TERMS: OwnTerm[] = [
  {
    id: 'improvement-proposal',
    term: 'Improvement proposal',
    aliases: ['Proposal'],
    kind: 'docs',
    blocks: [{ kind: 'p', text: 'A formal technical document defining standards, protocols, and upgrades for the network. It moves through statuses such as Draft, In Review, Approved and Final, and can also end Withdrawn, Rejected or Replaced.' }],
    source: { label: 'example/proposals', url: 'https://github.com/example/proposals' },
    related: ['Validator'],
  },
  {
    id: 'tvl',
    term: 'TVL',
    aliases: ['Total Value Locked'],
    kind: 'market',
    blocks: [{ kind: 'p', text: 'Total Value Locked. The total USD value of assets held across the network’s tracked DeFi activity, as reported by DefiLlama.' }],
    source: { label: 'DefiLlama', url: 'https://defillama.com/' },
  },
  {
    id: 'radar',
    term: 'Radar',
    aliases: ['Critical alerts'],
    kind: 'site',
    blocks: [{ kind: 'p', text: 'This site’s own tracker for upcoming operational events (upgrades, deadlines, breaking changes). Not an official network signal.' }],
    source: { label: 'Radar', url: '/radar' },
  },
];

const FALLBACK_TERMS: OwnTerm[] = ([
  { id: 'validator', term: 'Validator', kind: 'official', blocks: [{ kind: 'p', text: 'A node that takes part in the network, keeps its copy of the ledger and confirms transactions for the parties it hosts.' }] },
  { id: 'mainnet', term: 'Mainnet', kind: 'official', blocks: [{ kind: 'p', text: 'The production network, where assets have real value.' }] },
  { id: 'testnet', term: 'Testnet', kind: 'official', blocks: [{ kind: 'p', text: 'The staging network used to validate changes before they reach Mainnet. Its tokens have no value.' }] },
] as Omit<OwnTerm, 'source'>[]).map(t => ({ ...t, source: { label: 'Official glossary', url: `${PRIMARY_GLOSSARY_URL}#${t.id}` } }));

export function termKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function splitName(term: string): { name: string; aliases: string[] } {
  const also = /\s*\(sometimes also called ([^)]+)\)\s*$/i.exec(term);
  if (also) return { name: term.slice(0, also.index).trim(), aliases: [also[1].trim()] };
  const paren = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(term);
  if (paren) return { name: paren[1].trim(), aliases: [paren[2].trim()] };
  return { name: term, aliases: [] };
}

export function mergeGlossary(input: {
  primary: ParsedTerm[];
  reference: { terms: ParsedTerm[]; aliases: ParsedAlias[] };
}, olderNamePrefix: RegExp | null = OLDER_NAME_PREFIX): GlossaryEntry[] {
  const entries: (GlossaryEntry & { relatedNames: string[] })[] = [];
  const byKey = new Map<string, GlossaryEntry & { relatedNames: string[] }>();
  const usedIds = new Set<string>();
  const index = (e: GlossaryEntry & { relatedNames: string[] }) => {
    for (const k of [e.term, splitName(e.term).name, ...e.aliases].map(termKey)) if (k && !byKey.has(k)) byKey.set(k, e);
  };
  const add = (e: GlossaryEntry & { relatedNames: string[] }) => {
    let id = e.id || slugify(e.term);
    for (let n = 2; usedIds.has(id); n++) id = `${e.id || slugify(e.term)}-${n}`;
    usedIds.add(id);
    const entry = { ...e, id };
    entries.push(entry);
    index(entry);
    return entry;
  };
  const find = (name: string) => byKey.get(termKey(name)) ?? byKey.get(termKey(splitName(name).name));

  const official = input.primary.length > 0
    ? input.primary.map(t => ({
      id: t.slug ?? slugify(t.term), term: t.term, aliases: splitName(t.term).aliases, kind: 'official' as const, blocks: t.blocks,
      related: [], relatedNames: t.related, alsoIn: [],
      source: { label: 'Official glossary', url: `${PRIMARY_GLOSSARY_URL}#${t.slug ?? slugify(t.term)}` },
    }))
    : FALLBACK_TERMS.map(t => ({ ...t, aliases: t.aliases ?? [], related: [], relatedNames: t.related ?? [], alsoIn: [] }));
  for (const e of official) add(e);

  const referenceSource = { label: 'Reference glossary', url: REFERENCE_GLOSSARY_URL };
  for (const t of input.reference.terms) {
    const { name, aliases } = splitName(t.term);
    const older = olderNamePrefix ? olderNamePrefix.exec(name)?.[1] : undefined;
    const existing = find(t.term) ?? find(name) ?? (older ? find(older) : undefined);
    if (existing) {
      existing.alsoIn.push({ ...referenceSource, blocks: t.blocks });
      for (const a of [...aliases, ...(older && termKey(name) !== termKey(existing.term) ? [name] : [])]) if (!existing.aliases.includes(a)) existing.aliases.push(a);
      index(existing);
      continue;
    }
    const single = t.blocks.length === 1 ? find(t.blocks[0].text) : undefined;
    if (single && t.blocks[0].text.split(/\s+/).length <= 3) {
      if (!single.aliases.includes(name)) single.aliases.push(name);
      index(single);
      continue;
    }
    add({ id: slugify(name), term: name, aliases, kind: 'reference', blocks: t.blocks, related: [], relatedNames: [], alsoIn: [], source: referenceSource });
  }
  for (const a of input.reference.aliases) {
    const target = find(a.target);
    if (target && termKey(a.alias) !== termKey(target.term) && !target.aliases.includes(a.alias) && !find(a.alias)) {
      target.aliases.push(a.alias);
      index(target);
    }
  }

  for (const t of OWN_TERMS) {
    if (find(t.term)) continue;
    add({ ...t, aliases: t.aliases ?? [], related: [], relatedNames: t.related ?? [], alsoIn: [] });
  }

  const sortKey = (s: string) => s.replace(/^[^A-Za-z0-9]+/, '').toLowerCase();
  return entries
    .map(({ relatedNames, ...e }) => ({
      ...e,
      related: relatedNames
        .map(n => find(n))
        .filter((r): r is GlossaryEntry & { relatedNames: string[] } => Boolean(r) && r!.id !== e.id)
        .filter((r, i, all) => all.findIndex(x => x.id === r.id) === i)
        .map(r => ({ id: r.id, term: r.term })),
    }))
    .sort((a, b) => sortKey(a.term).localeCompare(sortKey(b.term)));
}

let cache: Glossary | null = null;

type GlossaryRow = { url: string; content_html: string | null; last_modified: string | null };

export function getGlossary(): Glossary {
  const db = getDb();
  const stamps = db.prepare('SELECT url, last_modified, synced_at, length(content_html) AS size FROM doc_pages WHERE url IN (?, ?) ORDER BY url')
    .all(PRIMARY_GLOSSARY_URL, REFERENCE_GLOSSARY_URL) as { url: string; last_modified: string | null; synced_at: string | null; size: number | null }[];
  const stamp = stamps.map(r => `${r.url}|${r.last_modified}|${r.synced_at}|${r.size ?? 0}`).join(';');
  if (cache && cache.stamp === stamp) return cache;

  const rows = db.prepare('SELECT url, content_html, last_modified FROM doc_pages WHERE url IN (?, ?)')
    .all(PRIMARY_GLOSSARY_URL, REFERENCE_GLOSSARY_URL) as GlossaryRow[];
  const primaryRow = rows.find(r => r.url === PRIMARY_GLOSSARY_URL);
  const referenceRow = rows.find(r => r.url === REFERENCE_GLOSSARY_URL);
  const primary = primaryRow?.content_html ? parseHeadingGlossary(primaryRow.content_html) : [];
  const reference = referenceRow?.content_html ? parseQuoteGlossary(referenceRow.content_html) : { terms: [], aliases: [] };
  const headings = (html: string | null | undefined, re: RegExp) => (html?.match(re) ?? []).length;
  cache = {
    stamp,
    entries: mergeGlossary({ primary, reference }),
    sources: [
      { label: 'Official glossary', url: PRIMARY_GLOSSARY_URL, held: Boolean(primaryRow), updated: primaryRow?.last_modified ?? null, terms: primary.length, parsed: primary.length, headings: headings(primaryRow?.content_html, /<h3\b[^>]*\bid="[^"]+"/g) },
      { label: 'Reference glossary', url: REFERENCE_GLOSSARY_URL, held: Boolean(referenceRow), updated: referenceRow?.last_modified ?? null, terms: reference.terms.length, parsed: reference.terms.length + reference.aliases.length, headings: headings(referenceRow?.content_html?.slice(Math.max(0, referenceRow.content_html.indexOf('<div class="glossary">'))), /<span data-as="p">[\s\S]*?<\/span>\s*<(?:blockquote|ul)>/g) },
    ],
  };
  return cache;
}
