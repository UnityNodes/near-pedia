export interface DefinitionBlock {
  kind: 'p' | 'li';
  text: string;
}

export interface ParsedTerm {
  slug: string | null;
  term: string;
  blocks: DefinitionBlock[];
  related: string[];
}

export interface ParsedAlias {
  alias: string;
  target: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  middot: '·', bull: '•', rarr: '→', larr: '←', times: '×', copy: '©', reg: '®', trade: '™', para: '¶', sect: '§',
};

function codePoint(text: string, cp: number): string {
  return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : text;
}

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (m, h: string) => codePoint(m, parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d: string) => codePoint(m, Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}

const INLINE_TAG = /<\/?(?:a|abbr|b|code|em|i|kbd|mark|small|span|strong|sub|sup|u)\b[^>]*>/gi;

export function htmlText(fragment: string): string {
  return decode(fragment.replace(INLINE_TAG, '').replace(/<[^>]+>/g, ' '))
    .replace(/[​‌‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

function blocksOf(fragment: string): DefinitionBlock[] {
  const out: DefinitionBlock[] = [];
  for (const m of fragment.matchAll(/<span data-as="p">([\s\S]*?)<\/span>|<li>([\s\S]*?)<\/li>/g)) {
    const text = htmlText(m[1] ?? m[2] ?? '');
    if (text) out.push({ kind: m[1] !== undefined ? 'p' : 'li', text });
  }
  return out;
}

export function parseHeadingGlossary(html: string): ParsedTerm[] {
  const terms: ParsedTerm[] = [];
  const parts = html.split(/(?=<h3\b)/);
  for (const part of parts) {
    const head = /^<h3\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h3>/.exec(part);
    if (!head) continue;
    const term = htmlText(head[2]);
    if (!term) continue;
    const body = part.slice(head[0].length).split(/<h2\b/)[0];
    const relatedMatch = /<span data-as="p"><strong>Related<\/strong>\s*:\s*([\s\S]*?)<\/span>/.exec(body);
    const related = relatedMatch ? htmlText(relatedMatch[1]).split(',').map(s => s.trim()).filter(Boolean) : [];
    const definition = relatedMatch ? body.replace(relatedMatch[0], '') : body;
    const blocks = blocksOf(definition);
    if (blocks.length) terms.push({ slug: head[1], term, blocks, related });
  }
  return terms;
}

export function parseQuoteGlossary(html: string): { terms: ParsedTerm[]; aliases: ParsedAlias[] } {
  const start = html.indexOf('<div class="glossary">');
  if (start === -1) return { terms: [], aliases: [] };
  const body = html.slice(start);
  const terms: ParsedTerm[] = [];
  const aliases: ParsedAlias[] = [];
  for (const m of body.matchAll(/<span data-as="p">([\s\S]*?)<\/span>\s*(<blockquote>[\s\S]*?<\/blockquote>|<ul>[\s\S]*?<\/ul>)/g)) {
    const term = htmlText(m[1]);
    if (!term) continue;
    const blocks = blocksOf(m[2]);
    const only = blocks.length === 1 ? blocks[0].text : '';
    const codes = [...m[2].matchAll(/<code>([^<]+)<\/code>/g)].map(c => htmlText(c[1]));
    const aliasTarget = codes.length === 1 && only.replace(/^abbreviation for\s+/i, '').trim() === codes[0] ? codes[0] : null;
    if (aliasTarget) aliases.push({ alias: term, target: aliasTarget });
    else if (blocks.length) terms.push({ slug: null, term, blocks, related: [] });
  }
  return { terms, aliases };
}
