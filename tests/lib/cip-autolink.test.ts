import { describe, it, expect } from 'vitest';
import { autolinkCips, autolinkCipsMarkdown, extractCipReferences } from '@/lib/cip-autolink';

describe('autolinkCips', () => {
  it('links CIP-N → /cips/000N (padded)', () => {
    expect(autolinkCips('See CIP-42 for details.')).toBe(
      'See <a href="/cips/0042">CIP-0042</a> for details.'
    );
  });

  it('handles already-padded CIP-0042', () => {
    expect(autolinkCips('CIP-0042')).toBe('<a href="/cips/0042">CIP-0042</a>');
  });

  it('handles space form CIP 0042', () => {
    expect(autolinkCips('CIP 0042 was approved')).toBe(
      '<a href="/cips/0042">CIP-0042</a> was approved'
    );
  });

  it('handles lowercase cip-42 but emits canonical CIP-NNNN', () => {
    expect(autolinkCips('see cip-42 above')).toBe(
      'see <a href="/cips/0042">CIP-0042</a> above'
    );
  });

  it('does not link bare numbers without CIP prefix', () => {
    expect(autolinkCips('42 is a number')).toBe('42 is a number');
  });

  it('does not link inside word boundaries (CIPSomething)', () => {
    expect(autolinkCips('CIPSomething42')).toBe('CIPSomething42');
  });

  it('links multiple references in one string', () => {
    const out = autolinkCips('CIP-1 supersedes CIP-2.');
    expect(out).toBe('<a href="/cips/0001">CIP-0001</a> supersedes <a href="/cips/0002">CIP-0002</a>.');
  });

  it('handles empty string', () => {
    expect(autolinkCips('')).toBe('');
  });

  it('skipInsideTags avoids double-wrap inside existing <a>', () => {
    const out = autolinkCips(
      'Mentions <a href="/cips/0042">CIP-0042</a> and also CIP-7 plain.',
      { skipInsideTags: true }
    );
    expect(out).toBe(
      'Mentions <a href="/cips/0042">CIP-0042</a> and also <a href="/cips/0007">CIP-0007</a> plain.'
    );
  });
});

describe('autolinkCipsMarkdown', () => {
  it('emits [CIP-NNNN](/cips/NNNN)', () => {
    expect(autolinkCipsMarkdown('See CIP-42 here')).toBe(
      'See [CIP-0042](/cips/0042) here'
    );
  });

  it('multiple in one line', () => {
    expect(autolinkCipsMarkdown('CIP-1 vs CIP-2')).toBe(
      '[CIP-0001](/cips/0001) vs [CIP-0002](/cips/0002)'
    );
  });
});

describe('extractCipReferences', () => {
  it('returns deduplicated, sorted, zero-padded numbers', () => {
    const refs = extractCipReferences('CIP-42 and CIP-2 and again CIP 0042 plus CIP-7');
    expect(refs).toEqual(['0002', '0007', '0042']);
  });

  it('returns [] for text without CIPs', () => {
    expect(extractCipReferences('no proposals mentioned')).toEqual([]);
  });

  it('returns [] for empty input', () => {
    expect(extractCipReferences('')).toEqual([]);
  });

  it('is stateless across calls (no /g flag leakage)', () => {
    extractCipReferences('CIP-1 CIP-2');
    expect(extractCipReferences('CIP-3')).toEqual(['0003']);
  });
});
