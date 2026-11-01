import { describe, it, expect } from 'vitest';
import { contentsOf, isHeadingLine, readerText, wordsOf } from '@/lib/whitepaper-text';

const HEADER = 'YourChain Coin: A YourChain-native payment application';
const page = (n: number, body: string) => `${HEADER}\n\n${body}\n\n​ ${n}\n`;
const TEXT = [
  page(1, 'Abstract\nAccessibility and connectivity across subnets\nis the subject.\n\nDisclaimer\nThis document is not advice.'),
  page(2, 'Transfer Fees\n\nparameter value\n\nthe first $100 1.0 %\n\nabove $100 up to $1000 0.1 %\n\nA.1 Name YourChain Foundation\n\nFigure 2: Cumulative Minting Over Time'),
  page(3, 'YourChain\n22 is a next generation layer 1.\n\n1. user\n2. weight'),
  page(4, 'Conclusion\nThat is all.'),
].join('\f');

describe('readerText', () => {
  const { blocks, removed } = readerText(TEXT);
  const texts = blocks.flatMap(b => (b.kind === 'page' ? [] : [b.text]));

  it('keeps every short block the old reader dropped, such as table rows and form fields', () => {
    expect(texts).toEqual(expect.arrayContaining(['parameter value', 'the first $100 1.0 %', 'above $100 up to $1000 0.1 %', 'A.1 Name YourChain Foundation']));
  });

  it('loses no word except the running header and page numbers it removes', () => {
    const count = (ws: string[]) => ws.reduce((m, w) => m.set(w, (m.get(w) ?? 0) + 1), new Map<string, number>());
    const src = count(wordsOf(TEXT)), got = count(wordsOf(texts.join(' '))), gone = count(removed.lines.flatMap(l => wordsOf(l)));
    for (const [w, n] of src) expect({ w, kept: (got.get(w) ?? 0) + (gone.get(w) ?? 0) }).toEqual({ w, kept: n });
    expect(removed.runningHeaders).toEqual([HEADER]);
    expect(removed.pageNumbers).toBe(4);
  });

  it('splits a heading from the sentence it was glued to and gives it an anchor', () => {
    expect(blocks[0]).toEqual({ kind: 'heading', text: 'Abstract', id: 'abstract', level: 2 });
    expect(blocks[1]).toEqual({ kind: 'p', text: 'Accessibility and connectivity across subnets is the subject.' });
    expect(blocks.filter(b => b.kind === 'heading').map(b => (b as { text: string }).text)).toEqual(['Abstract', 'Disclaimer', 'Transfer Fees', 'Conclusion']);
  });

  it('marks each page after the first with its number, and drops the page-break and invisible characters', () => {
    expect(blocks.filter(b => b.kind === 'page')).toEqual([{ kind: 'page', n: 2 }, { kind: 'page', n: 3 }, { kind: 'page', n: 4 }]);
    expect(texts.join(' ')).not.toMatch(/[\f​]/);
  });

  it('keeps a line broken by a footnote number as one paragraph', () => {
    expect(texts).toContain('YourChain 22 is a next generation layer 1.');
  });

  it('answers an empty text with nothing', () => {
    expect(readerText(null).blocks).toEqual([]);
    expect(readerText('').blocks).toEqual([]);
  });
});

describe('readerText headings', () => {
  const headings = (text: string) => readerText(text).blocks.filter(b => b.kind === 'heading').map(b => (b as { text: string }).text);

  it('finds a numbered section that starts in the middle of a paragraph, after a sentence ends', () => {
    expect(headings('benefit from full sub-transaction privacy.\n2 YourChain\nYourChain is a distributed ledger.\n2.1 Architecture\nNodes are called participants.')).toEqual(['2 YourChain', '2.1 Architecture']);
  });

  it('does not split a paragraph at a number that does not follow a sentence end', () => {
    expect(headings('and signed by the Executive Director\n548 Market Street\nSan Francisco, California.')).toEqual([]);
  });

  it('takes a numbered list as a list, not as headings', () => {
    expect(headings('1. Bank issues some cash to Alice\n2. CSD issues an asset to Deborah\n3. Alice proposes a swap')).toEqual([]);
  });

  it('takes the labels inside a figure as part of the figure', () => {
    const text = 'The parties agree on the swap, as shown below in the figure.\n\nVisible to Alice, Bob\nBob exercises swap on\n#1: SwapOffer\n\nResult\nTime\n\nFigure 2: A sample transaction.';
    expect(headings(text)).toEqual([]);
  });

  it('keeps a heading above a table when prose follows the table', () => {
    expect(headings('Transfer Fees\n\nthe first $100 1.0 %\n\nabove $100 0.1 %\n\nThe fee falls as the amount grows, so a large transfer pays less.\n\nFigure 2: Fees')).toEqual(['Transfer Fees']);
  });

  it('joins a lettered or Part heading that wraps onto the next lines', () => {
    const text = [
      'D. The Economic Model for YourChain Coin is Designed to Disincentivize Price Speculation and\nInstead Encourage the Development of Useful Applications\n\nFourth and finally, the model holds.',
      'Part C- Information about the operator of the trading platform in cases where it draws up the white\npaper and information about other persons drawing the white paper pursuant to Article 6(1),\nsecond subparagraph\n\nThe operator is named below in this part.',
    ].join('\n\n');
    expect(headings(text)).toEqual([
      'D. The Economic Model for YourChain Coin is Designed to Disincentivize Price Speculation and Instead Encourage the Development of Useful Applications',
      'Part C- Information about the operator of the trading platform in cases where it draws up the white paper and information about other persons drawing the white paper pursuant to Article 6(1), second subparagraph',
    ]);
  });

  it('makes a numbered subsection a level-3 heading and leaves the paper title out of the contents', () => {
    const { blocks } = readerText('Polyglot YourChain\nThe paper opens with its title, then the sections.\n\n2 YourChain\nYourChain is a ledger.\n2.1 Architecture\nNodes are participants.');
    expect(contentsOf(blocks, 'Polyglot YourChain')).toEqual([
      { id: '2-yourchain', text: '2 YourChain', level: 2 },
      { id: '2-1-architecture', text: '2.1 Architecture', level: 3 },
    ]);
  });

  it('joins a bare section numeral to the title on the next line', () => {
    expect(headings('II.\nExample Labs’s Technology- and Use Case-First Approach\n\nExample Labs took the opposite path from the start.\n\nI.\nDigital Tokens to Date—“Tokens First, Technology Later”\n\nWe are fifteen years from when the first token appeared.')).toEqual([
      'II. Example Labs’s Technology- and Use Case-First Approach',
      'I. Digital Tokens to Date—“Tokens First, Technology Later”',
    ]);
  });

  it('does not take a one-line paragraph without a period as the rest of a numbered heading', () => {
    const { blocks } = readerText('2.1 Architecture\nNodes are called participants\n\nEach participant hosts parties and runs the protocol for them.');
    expect(blocks.slice(0, 2)).toEqual([
      { kind: 'heading', text: '2.1 Architecture', id: '2-1-architecture', level: 3 },
      { kind: 'p', text: 'Nodes are called participants' },
    ]);
  });

  it('keeps the headings of a page whose table rows end in numbers that do not ascend like page numbers', () => {
    expect(headings('Overview\nThe network grows each year, as the table below shows clearly.\n\nYear 1 40\nYear 2 35\nYear 3 20\nYear 4 15\nYear 5 12\nYear 6 9')).toEqual(['Overview']);
  });

  it('keeps the line breaks of the end of a contents that runs onto a page of text', () => {
    const text = 'Renewable energy sources 34\nEnergy consumption 34\nSources and methodologies 35\n\nSummary\nThis summary is a warning to the reader of this white paper.\nIt should be read as an introduction to the paper as a whole.\nAny decision to buy should rest on the paper as a whole.';
    expect(readerText(text).blocks[0]).toEqual({ kind: 'p', text: 'Renewable energy sources 34\nEnergy consumption 34\nSources and methodologies 35', keepLines: true });
    expect(headings(text)).toEqual(['Summary']);
  });

  it('loses no word on any of the new paths: split sections, wrapped and numeral headings, lists, figures and contents', () => {
    const text = [
      'ends a sentence.\n2 YourChain\nYourChain is a ledger.',
      'D. The Model is Designed to Disincentivize Speculation and\nInstead Encourage Applications\n\nFourth, it holds.',
      'IV.\nLedger and Token\n\nTo address this, a token.',
      '1. Bank issues cash\n2. CSD issues an asset',
      'Visible to Alice, Bob\nBob exercises swap on\n\nFigure 2: A sample.',
      'Summary 7\nRisks 11\nProject 16\nCourt 19\nTechnology 22',
    ].join('\f');
    const { blocks, removed } = readerText(text);
    const kept = blocks.flatMap(b => (b.kind === 'page' ? [] : [b.text])).join(' ');
    const count = (ws: string[]) => ws.reduce((m, w) => m.set(w, (m.get(w) ?? 0) + 1), new Map<string, number>());
    const src = count(wordsOf(text)), got = count(wordsOf(kept)), gone = count(removed.lines.flatMap(l => wordsOf(l)));
    for (const [w, n] of src) expect({ w, kept: (got.get(w) ?? 0) + (gone.get(w) ?? 0) }).toEqual({ w, kept: n });
    for (const [w, n] of got) expect({ w, n: Math.min(n, src.get(w) ?? 0) }).toEqual({ w, n });
  });

  it('takes no headings from a contents page, whose lines end in page numbers', () => {
    const contents = ['N Field Content', 'Summary 7', 'Part I – Information on risks 11', 'Offer-Related Risks 11', 'Part D- Information about the project 16', 'Competent court 19'].join('\n\n');
    expect(headings(`${contents}\fSummary\nThis summary is a warning to the reader.`)).toEqual(['Summary']);
  });

  it('keeps the line breaks of a contents page instead of gluing its entries into one paragraph', () => {
    const contents = ['Summary 7', 'Part I – Information on risks 11', 'Offer-Related Risks 11', 'Part D- Information about the project 16', 'Competent court 19'].join('\n');
    expect(readerText(contents).blocks).toEqual([{ kind: 'p', text: contents, keepLines: true }]);
  });
});

describe('isHeadingLine', () => {
  it.each(['Abstract', '1 Introduction', '2.5 Smart Contracts in YourChain', 'Part I – Information on risks', 'B. Example Labs’s Technology is Mature and Tested with Proven Use Cases'])('takes %s as a heading', l => {
    expect(isHeadingLine(l)).toBe(true);
  });

  it.each(['the first $100 1.0 %', 'A.1 Name YourChain Foundation', 'Figure 2: Cumulative Minting', '1. user', 'Business Activity 14', 'February 2025', 'Party2', 'S’ = S + T', 'CREATE POLICY asset_issuers ON Asset', 'This ends with a period.', 'Source: VeChain documentation', '1. Base transfer fee - A fee applied to every new coin contract record (UTXO) created in a'])('does not take %s as a heading', l => {
    expect(isHeadingLine(l)).toBe(false);
  });
});
