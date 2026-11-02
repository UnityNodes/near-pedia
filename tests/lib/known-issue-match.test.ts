import { describe, it, expect } from 'vitest';
import { coversHalf, titleNamesTopic } from '../../lib/rank';

describe('coversHalf', () => {
  it('keeps a report holding half of the discriminative words', () => {
    const tokens = ['near', 'api', 'transaction', 'fails', 'nonce'];
    expect(coversHalf(tokens, 'Nonce related problems: the transaction fails on near-js/client')).toBe(true);
  });

  it('drops a report that shares one word with the description', () => {
    const tokens = ['cargo', 'near', 'build', 'fails', 'wasm', 'opt'];
    expect(coversHalf(tokens, 'I want to build the next level of the web')).toBe(false);
  });

  it('matches whole words, so "work" is not found inside "network"', () => {
    expect(coversHalf(['work'], 'network')).toBe(false);
  });

  it('finds a plural or longer form of a needle of four or more letters', () => {
    expect(coversHalf(['wallet'], 'Wallets disconnect after upgrade')).toBe(true);
    expect(coversHalf(['transaction', 'nonce'], 'Transactions failing with nonces')).toBe(true);
    expect(coversHalf(['api'], 'apiary')).toBe(false);
  });

  it('ignores stopwords, "not" among them', () => {
    expect(coversHalf(['wallet', 'selector', 'not', 'with'], 'wallet selector')).toBe(true);
    expect(coversHalf(['wallet', 'selector', 'not'], 'not total emissions')).toBe(false);
  });
});

describe('titleNamesTopic', () => {
  it('does not count the network name every title carries', () => {
    expect(titleNamesTopic(['cargo', 'near', 'build'], 'House of Stake: NEAR budget', 'NEAR')).toBe(false);
    expect(titleNamesTopic(['cargo', 'near', 'build'], 'cargo-near build hangs', 'NEAR')).toBe(true);
  });

  it('passes when the description has no discriminative word left', () => {
    expect(titleNamesTopic(['near', 'how'], 'anything', 'NEAR')).toBe(true);
  });
});
