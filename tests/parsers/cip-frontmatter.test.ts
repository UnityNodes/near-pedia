// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseCipFrontmatter } from '@/lib/parsers/cip-frontmatter';

const SAMPLE_MODERN = `## CIP 0100

<pre>
Number: CIP 0100
Title: Governance of the CIP 0082 Grant Programme
Author(s): W Eric Saraniecki
  Bernhard Elsner
Type: Tokenomics
Status: Active
Requires: CIP 0082-Establish a 5% Grant Programme
Created: 2025-12-22
Approved: 2026-01-14
License: CC0-1.0
</pre>

## Abstract
Some content here.`;

const SAMPLE_OLD = `<pre>
  CIP: CIP 0001
  Title:  Replace the SV tranche
  Author: Eric Saraniecki
  Status: Final
  Type: Tokenomics
  Created: 2023-12-15
</pre>`;

const SAMPLE_PDF_ONLY = `## CIP 0001
* [CIP text](/cip-0001/CIP-0001.pdf)
* [Vote](/cip-0001/votes.pdf)`;

const SAMPLE_EMPTY = ``;

describe('parseCipFrontmatter', () => {
  it('extracts Title from modern format', () => {
    const meta = parseCipFrontmatter(SAMPLE_MODERN);
    expect(meta.Title).toBe('Governance of the CIP 0082 Grant Programme');
  });

  it('extracts Status', () => {
    const meta = parseCipFrontmatter(SAMPLE_MODERN);
    expect(meta.Status).toBe('Active');
  });

  it('extracts Type', () => {
    const meta = parseCipFrontmatter(SAMPLE_MODERN);
    expect(meta.Type).toBe('Tokenomics');
  });

  it('extracts Author(s) including multi-line continuation', () => {
    const meta = parseCipFrontmatter(SAMPLE_MODERN);
    expect(meta['Author(s)']).toContain('W Eric Saraniecki');
    expect(meta['Author(s)']).toContain('Bernhard Elsner');
  });

  it('extracts Created date', () => {
    const meta = parseCipFrontmatter(SAMPLE_MODERN);
    expect(meta.Created).toBe('2025-12-22');
  });

  it('extracts Approved date', () => {
    const meta = parseCipFrontmatter(SAMPLE_MODERN);
    expect(meta.Approved).toBe('2026-01-14');
  });

  it('handles old CIP key variant (CIP: instead of Number:)', () => {
    const meta = parseCipFrontmatter(SAMPLE_OLD);
    expect(meta.CIP).toBe('CIP 0001');
  });

  it('trims leading/trailing whitespace from values', () => {
    const meta = parseCipFrontmatter(SAMPLE_OLD);
    expect(meta.Title).toBe('Replace the SV tranche');
    expect(meta.Status).toBe('Final');
  });

  it('returns empty object for PDF-only CIP (no <pre> block)', () => {
    const meta = parseCipFrontmatter(SAMPLE_PDF_ONLY);
    expect(meta).toEqual({});
  });

  it('returns empty object for empty content', () => {
    const meta = parseCipFrontmatter(SAMPLE_EMPTY);
    expect(meta).toEqual({});
  });
});
