import { describe, expect, it } from 'vitest';
import { copyText, citedNumbers, linkCitations } from '@/app/ask/citations';

describe('ask citations', () => {
  it('links [n] in prose to the numbered source of that answer, and only when the source exists', () => {
    expect(linkCitations('Issuance falls [1][2], see [9].', 't1', 2)).toBe('Issuance falls [1](#ak-src-t1-1)[2](#ak-src-t1-2), see [9].');
  });

  it('leaves code spans and fences as written', () => {
    const text = 'Use `args[1]` here [1].\n```ts\nconst a = accounts[2];\n```\nDone [2]';
    expect(linkCitations(text, 't', 3)).toBe('Use `args[1]` here [1](#ak-src-t-1).\n```ts\nconst a = accounts[2];\n```\nDone [2](#ak-src-t-2)');
  });

  it('counts only what the prose cites', () => {
    expect([...citedNumbers('See [3] and `x[1]`.\n```\ny[2]\n```')]).toEqual([3]);
  });
});

describe('copying an answer', () => {
  it('appends the cited sources with their links and dates, and skips the ones not cited', () => {
    const sources = [
      { n: 1, title: 'near-sdk-js', url: 'https://github.com/near/near-sdk-js', as_of: '2026-11-03T10:00:00Z' },
      { n: 2, title: 'unused', url: null, as_of: null },
    ];
    expect(copyText('Do not use it [1].', sources)).toBe('Do not use it [1].\n\nSources:\n[1] near-sdk-js - https://github.com/near/near-sdk-js (read 2026-11-03)');
    expect(copyText('No citations here.', sources)).toBe('No citations here.');
  });
});
