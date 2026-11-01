import { describe, it, expect } from 'vitest';
import { glossaryProblems, rawPrimaryTerms, rawReferenceEntries } from '../../scripts/check-glossary';
import { PRIMARY_GLOSSARY_URL, REFERENCE_GLOSSARY_URL } from '@/lib/glossary';

const PRIMARY = '<h3 id="fees"><span>Fees</span></h3><span data-as="p">Paid.</span><h3 id="validator"><span>Validator</span></h3><span data-as="p">Runs a node.</span>';
const REFERENCE = '<div class="glossary"><span data-as="p">Coin Engine</span><blockquote><span data-as="p">Code for NC.</span></blockquote><span data-as="p">NC</span><blockquote><span data-as="p"><code>Network Coin</code></span></blockquote></div>';
const rows = (o: string | null, s: string | null) => [
  ...(o === null ? [] : [{ url: PRIMARY_GLOSSARY_URL, content_html: o }]),
  ...(s === null ? [] : [{ url: REFERENCE_GLOSSARY_URL, content_html: s }]),
];

describe('check-glossary', () => {
  it('counts the raw headings of both pages', () => {
    expect(rawPrimaryTerms(PRIMARY)).toBe(2);
    expect(rawReferenceEntries(REFERENCE)).toBe(2);
  });

  it('passes when every heading parsed and the old anchors resolve', () => {
    expect(glossaryProblems(rows(PRIMARY, REFERENCE), ['fees', 'validator'])).toEqual([]);
  });

  it('fails when a page is gone, when headings stop parsing, and when an old anchor loses its target', () => {
    expect(glossaryProblems(rows(null, REFERENCE), ['validator'])[0]).toMatch(/official glossary .* is not held/);
    expect(glossaryProblems(rows(PRIMARY.replace(/<span data-as="p">/g, '<p>'), REFERENCE), ['validator'])[0]).toMatch(/2 term headings and 0 parsed/);
    expect(glossaryProblems(rows(PRIMARY, '<main>moved</main>'), ['validator'])[0]).toMatch(/reference glossary page holds no entries/);
    expect(glossaryProblems(rows(PRIMARY, REFERENCE), ['fees'], { v: 'validator' })).toEqual(['the old anchor #v points at #validator, which no term has any more']);
  });
});
