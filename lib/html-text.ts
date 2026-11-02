/** Plain text of an HTML fragment: inline tags dropped, block tags to spaces, entities decoded. */

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
