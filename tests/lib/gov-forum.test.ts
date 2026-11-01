import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hspNumber, parseListing, parseTopic, titleKey, toPostRows } from '@/lib/gov-forum';

const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'near', name), 'utf8'));

describe('parseListing on gov.near.org House of Stake (2026-11-01)', () => {
  const { topics, hasMore } = parseListing(fixture('gov-forum-c158.json'));

  it('reads topics of the parent and its subcategories with canonical URLs', () => {
    expect(topics.length).toBeGreaterThanOrEqual(5);
    expect([...new Set(topics.map((t) => t.category_id))]).toEqual(expect.arrayContaining([98, 168]));
    const t = topics.find((x) => x.id === 42548)!;
    expect(t.category_id).toBe(168);
    expect(t.url).toMatch(/^https:\/\/gov\.near\.org\/t\/[\w-]+\/42548$/);
    expect(hasMore).toBe(true);
  });

  it('throws on something that is not a listing instead of reading it as empty', () => {
    expect(() => parseListing({ errors: ['not found'] })).toThrow(/not a Discourse topic listing/);
  });
});

describe('parseTopic on HSP-027 (2026-11-01)', () => {
  it('reads the post stream ids and the posts with their like counts', () => {
    const t = parseTopic(fixture('gov-forum-t42213.json'));
    expect(t.id).toBe(42213);
    expect(t.stream.length).toBeGreaterThanOrEqual(t.posts.length);
    expect(t.posts[0]).toMatchObject({ topic_id: 42213, post_number: 1 });
    expect(t.posts[0].cooked.length).toBeGreaterThan(50);
  });

  it('drops hidden and author-deleted posts', () => {
    const rows = toPostRows(1, [
      { id: 1, post_number: 1, cooked: '<p>a</p>' },
      { id: 2, post_number: 2, cooked: '<p>(post withdrawn)</p>', user_deleted: true },
      { id: 3, post_number: 3, cooked: '<p>spam</p>', hidden: true },
      { id: 4, post_number: 4, cooked: '<p>b</p>', actions_summary: [{ id: 2, count: 5 }] },
    ]);
    expect(rows.map((r) => [r.id, r.like_count])).toEqual([[1, 0], [4, 5]]);
  });
});

describe('HSP matching', () => {
  it.each([
    ['HSP-027: Remove the NEAR Developer Gas Rebate', 27],
    ['HSP 29 – Issuance ramp', 29],
    ['Sensing Proposal (7-Day Sensing Period) - HSP-005: Delegate rewards', 5],
    ['DRAFT HSP-XXX: Community Growth Initiative', null],
    ['NEARCLIPS — Clip-Making Marketplace', null],
    ['DRAFT HSP-030: Treasury policy', 30],
    ['(Deprecated) HSP-005: House of Stake - Code of Conduct', 5],
    ['Feedback on HSP-8 wording', null],
    ['NEAR House of Stake Constitutional Documents (HSP 008-012)', null],
    ['HSP 2026 budget review', null],
  ])('%s -> %s', (title, n) => {
    expect(hspNumber(title)).toBe(n);
  });

  it('keys an on-chain title and its forum thread alike', () => {
    expect(titleKey('HSP-027: Remove the NEAR Developer Gas Rebate')).toBe(titleKey('Remove the NEAR Developer Gas Rebate'));
    expect(titleKey('DRAFT HSP-XXX: Community Growth Initiative')).toBe('community growth initiative');
  });
});
