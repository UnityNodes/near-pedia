import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BLOG_SOURCES, articleText, parsePost, postUrls } from '@/lib/near-blogs';

const fixture = (f: string) => fs.readFileSync(path.join(__dirname, '../fixtures/near-blogs', f), 'utf8');
const [nearOrg, nearAi] = BLOG_SOURCES;

describe('postUrls', () => {
  it('keeps one-segment post URLs and drops category, page and tag listings', () => {
    const xml = [
      'https://www.near.org/blog/chain-signatures-tee',
      'https://www.near.org/blog/chain-signatures-tee/',
      'https://www.near.org/blog/category/',
      'https://www.near.org/blog/category/alpha',
      'https://www.near.org/blog',
      'https://near.ai/blog/announcing-proof-of-response',
    ].map((u) => `<url><loc>${u}</loc></url>`).join('');
    expect(postUrls(xml, nearOrg)).toEqual(['https://www.near.org/blog/chain-signatures-tee']);
    expect(postUrls(xml, nearAi)).toEqual(['https://near.ai/blog/announcing-proof-of-response']);
  });
});

describe('parsePost', () => {
  it('reads a near.org post: title without the site suffix, date, article text', () => {
    const p = parsePost(fixture('near-org-post.html'), 'https://www.near.org/blog/chain-signatures-tee', nearOrg)!;
    expect(p.id).toBe('near-org:chain-signatures-tee');
    expect(p.title).toBe('Chain Signatures Now Run Inside TEEs');
    expect(p.published_at).toBe('2026-10-23T17:23:00.000Z');
    expect(p.content_text).toContain('17 independent operators');
    expect(p.tags).toBe('near.org blog');
  });

  it('reads a near.ai post', () => {
    const url = 'https://near.ai/blog/adi-foundation-and-datrics-partner-with-near-on-travai-an-ai-and-blockchain-powered-travel-platform';
    const p = parsePost(fixture('near-ai-post.html'), url, nearAi)!;
    expect(p.id).toMatch(/^near-ai:adi-foundation/);
    expect(p.title).toMatch(/^ADI Foundation and Datrics Partner With NEAR/);
    expect(p.published_at).toBe('2025-12-05T00:00:00.000Z');
    expect(p.author).toBe('NEAR AI');
  });

  it('refuses a page with no article text', () => {
    expect(parsePost('<html><main><p>Loading…</p></main></html>', 'https://www.near.org/blog/x', nearOrg)).toBeNull();
  });
});

describe('articleText', () => {
  const [org, ai] = BLOG_SOURCES;

  it('cuts a near.org post at the community footer and drops the Share line', () => {
    const text = 'Title\n Intents \n Share \n\n October 20, 2026\n\n The article.\n\n Join the community:\n • Telegram\n\n More posts\n\n Another post title';
    expect(articleText(text, org)).toBe('Title\n Intents \n\n October 20, 2026\n\n The article.');
  });

  it('cuts at More posts when the community block is missing', () => {
    expect(articleText('The article.\n More posts\n Other title', org)).toBe('The article.');
  });

  it('cuts a near.ai post at More from NEAR AI and drops the back link', () => {
    const text = '← All articles Cybersecurity Models\n October 29, 2026\n\n Body text.\n\n More from NEAR AI\n NEAR AI Team · October 26, 2026\n Other post';
    expect(articleText(text, ai)).toBe('Cybersecurity Models\n October 29, 2026\n\n Body text.');
  });

  it('keeps a word like Share inside a sentence', () => {
    expect(articleText('Share your thoughts on the forum.', org)).toBe('Share your thoughts on the forum.');
  });
});
