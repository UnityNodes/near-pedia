import { describe, it, expect } from 'vitest';
import { isFirstPartyDoc, serveDocText, docField } from '../../lib/doc-trust';

describe('isFirstPartyDoc', () => {
  it('trusts docs.near.org and NEAR-owned GitHub orgs', () => {
    expect(isFirstPartyDoc('https://docs.near.org/smart-contracts/what-is')).toBe(true);
    expect(isFirstPartyDoc('https://github.com/near/near-sdk-rs/blob/master/README.md')).toBe(true);
    expect(isFirstPartyDoc('https://raw.githubusercontent.com/near-examples/hello-near-examples/main/README.md')).toBe(true);
  });

  it('does not trust partner docs, other orgs or look-alike hosts', () => {
    expect(isFirstPartyDoc('https://docs.near-intents.org/integration/overview')).toBe(false);
    expect(isFirstPartyDoc('https://github.com/someone/near-tools')).toBe(false);
    expect(isFirstPartyDoc('https://docs.near.org.evil.example/x')).toBe(false);
    expect(isFirstPartyDoc(null)).toBe(false);
  });
});

describe('serveDocText', () => {
  it('passes first-party text through and fences the rest naming NEAR as the first party', () => {
    expect(serveDocText('https://docs.near.org/a', 'body')).toBe('body');
    const fenced = serveDocText('https://docs.trezu.org/a', 'body');
    expect(fenced).toContain('Third-party documentation from docs.trezu.org. Not published by NEAR.');
    expect(fenced).not.toMatch(/your-org|yourchain/);
  });

  it('fences a third-party title but not a first-party one', () => {
    expect(docField('https://docs.near.org/a', 'Title')).toBe('Title');
    expect(docField('https://docs.trezu.org/a', 'Title')).not.toBe('Title');
  });
});
