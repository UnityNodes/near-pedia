import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE_DOCS, parseSiteDoc, siteDocUrls } from '@/lib/site-docs';

const [nomicon] = SITE_DOCS;

describe('siteDocUrls', () => {
  it('keeps spec pages and drops the search and placeholder pages', () => {
    const xml = ['https://nomicon.io/RuntimeSpec/Actions', 'https://nomicon.io/search', 'https://nomicon.io/markdown-page', 'https://nomicon.io/Standards/'].map((u) => `<loc>${u}</loc>`).join('');
    expect(siteDocUrls(xml, nomicon)).toEqual(['https://nomicon.io/RuntimeSpec/Actions', 'https://nomicon.io/Standards']);
  });
});

describe('parseSiteDoc', () => {
  it('reads a Nomicon page: its own title, the spec text with its code', () => {
    const html = fs.readFileSync(path.join(__dirname, '../fixtures/nomicon-actions.html'), 'utf8');
    const page = parseSiteDoc(html, 'https://nomicon.io/RuntimeSpec/Actions', nomicon)!;
    expect(page.title).toBe('Actions');
    expect(page.url).toBe('https://nomicon.io/RuntimeSpec/Actions');
    expect(page.content_text).toContain('DeployGlobalContract');
  });

  it('refuses a page with no text', () => {
    expect(parseSiteDoc('<html><main></main></html>', 'https://nomicon.io/x', nomicon)).toBeNull();
  });
});
