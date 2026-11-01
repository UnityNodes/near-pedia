import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { markWords } from '@/components/doc-card';

const html = (text: string, q: string) => renderToStaticMarkup(<p>{markWords(text, q)}</p>);

describe('markWords', () => {
  it('marks the words the index matched: each query term as the start of a word, diacritics folded', () => {
    expect(html('A counterparty and a PartyKit party', 'party')).toBe('<p>A counterparty and a <mark>PartyKit</mark> <mark>party</mark></p>');
    expect(html('Thanks to György', 'gyorgy')).toBe('<p>Thanks to <mark>György</mark></p>');
    expect(html('the ledger api v2', 'ledger-api')).toBe('<p>the <mark>ledger</mark> <mark>api</mark> v2</p>');
  });

  it('leaves text alone without a query, and never builds markup from the text', () => {
    expect(html('<b>x</b>', '')).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>');
    expect(html('<b>x</b> bold', 'bold')).toBe('<p>&lt;b&gt;x&lt;/b&gt; <mark>bold</mark></p>');
  });
});
