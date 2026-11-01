import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, resetDb } from '@/lib/db';
import { RELEASE_PRODUCTS, currentReleases, findRelease, getRelease, getReleases, releaseFeed } from '@/lib/releases';
import { RELEASE_PRODUCT_SPECS, versionFromTag } from '@/lib/release-sources';

const SYNCED = '2026-10-25T00:00:00Z';

// Tags and dates as GitHub lists them for these repositories (2026-11-01).
function seed() {
  const ins = getDb().prepare('INSERT INTO github_releases (id, repo, tag, name, body, published_at, url, prerelease, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const rel = (id: string, repo: string, tag: string, date: string, body = '', prerelease = 0) =>
    ins.run(id, repo, tag, tag, body, date, `https://github.com/${repo}/releases/tag/${tag}`, prerelease, SYNCED);
  rel('101', 'near/nearcore', '2.14.0', '2026-10-26T12:00:00Z', '# Release of nearcore 2.14.0\n\n## Summary\n\nProtocol version 88. Removes DelegateV2.');
  rel('102', 'near/nearcore', '2.14.0-rc.7', '2026-10-26T10:00:00Z', '## Summary\n\nRelease candidate.', 1);
  rel('103', 'near/nearcore', '2.13.2', '2026-09-30T12:00:00Z', '```\nCODE_COLOR: CODE_RED_MAINNET, CODE_RED_TESTNET\nRELEASE_VERSION: 2.13.2\nPROTOCOL_UPGRADE: FALSE\nDATABASE_UPGRADE: FALSE\nSECURITY_UPGRADE: TRUE\n```\n\nThis release fixes critical flaws in nearcore code that could cause node crash.\nUpgrade as soon as possible to avoid node downtime.');
  rel('104', 'near/nearcore', '2.13.1', '2026-09-10T12:00:00Z', '## Summary\n\nMaintenance release.');
  rel('105', 'near/nearcore', '1.40.0', '2024-06-01T12:00:00Z', '## Summary\n\nThe last 1.x release.');
  rel('201', 'near/near-sdk-rs', 'near-sdk-v5.30.0', '2026-10-27T15:00:00Z');
  rel('202', 'near/near-sdk-rs', 'near-sys-v0.4.0', '2026-10-27T15:00:00Z');
  rel('203', 'near/near-sdk-rs', 'near-sdk-macros-v5.30.0', '2026-10-27T15:00:00Z');
  rel('204', 'near/near-sdk-rs', '4.1.1', '2022-11-10T12:00:00Z');
  rel('301', 'near/near-api-js', 'near-api-js@7.4.0', '2026-10-23T22:00:00Z');
  rel('302', 'near/near-api-js', '@near-js/accounts@2.5.1', '2025-11-06T14:00:00Z');
  rel('303', 'near/near-api-js', 'v4.0.0', '2024-04-01T12:00:00Z');
  rel('901', 'other-org/unrelated', 'v9.9.9', '2026-10-25T12:00:00Z');
}

describe('versionFromTag', () => {
  const spec = (key: string) => RELEASE_PRODUCT_SPECS.find(p => p.key === key)!;

  it.each([
    ['nearcore', '2.14.0', '2.14.0'],
    ['nearcore', '2.14.0-rc.7', '2.14.0-rc.7'],
    ['near-sdk', 'near-sdk-v5.30.0', '5.30.0'],
    ['near-sdk', '4.1.1', '4.1.1'],
    ['near-sdk', 'near-sys-v0.4.0', null],
    ['near-sdk', 'near-sdk-macros-v5.30.0', null],
    ['near-api-js', 'near-api-js@7.4.0', '7.4.0'],
    ['near-api-js', 'v4.0.0', '4.0.0'],
    ['near-api-js', '@near-js/accounts@2.5.1', null],
    ['cargo-near', 'cargo-near-build-v0.5.0', null],
  ])('%s %s -> %s', (key, tag, expected) => {
    expect(versionFromTag(spec(key), tag)).toBe(expected);
  });
});

describe('the release feed', () => {
  beforeEach(() => { resetDb(); seed(); });

  it('lists only the tags that belong to a product, newest first, pre-releases marked', () => {
    expect(releaseFeed().map(i => [i.id, i.prerelease])).toEqual([
      ['near-sdk-5.30.0', false],
      ['nearcore-2.14.0', false],
      ['nearcore-2.14.0-rc.7', true],
      ['near-api-js-7.4.0', false],
      ['nearcore-2.13.2', false],
      ['nearcore-2.13.1', false],
      ['nearcore-1.40.0', false],
      ['near-api-js-4.0.0', false],
      ['near-sdk-4.1.1', false],
    ]);
    expect(RELEASE_PRODUCTS.map(p => p.key)).toContain('near-sdk');
  });

  it('keeps the repository tag and the GitHub URL of a prefixed release', () => {
    const r = findRelease('near-sdk-5.30.0')!;
    expect(r).toMatchObject({ product: 'near-sdk', version: '5.30.0', tag: 'near-sdk-v5.30.0', repo: 'near/near-sdk-rs', line: '5.30' });
    expect(r.sourceUrl).toBe('https://github.com/near/near-sdk-rs/releases/tag/near-sdk-v5.30.0');
  });

  it('reads the summary from the notes and finds a release by the id of its old blog mirror', () => {
    expect(findRelease('nearcore-2.13.2')!.summary).toMatch(/^This release fixes critical flaws in nearcore code/);
    expect(findRelease('rel-101')!.id).toBe('nearcore-2.14.0');
    expect(findRelease('nope')).toBeNull();
  });

  it('marks the newest stable release of each line, never a pre-release', () => {
    expect(findRelease('nearcore-2.14.0')!.latestInLine).toBe(true);
    expect(findRelease('nearcore-2.13.2')!.latestInLine).toBe(true);
    expect(findRelease('nearcore-2.13.1')!.latestInLine).toBe(false);
    expect(findRelease('nearcore-2.14.0-rc.7')!.latestInLine).toBe(false);
  });

  it('gives a release its notes without the duplicate title, its line, and the newest stable release of its product', () => {
    const d = getRelease('nearcore-2.13.1')!;
    expect(d.inLine.map(i => i.version)).toEqual(['2.13.2', '2.13.1']);
    expect(d.latestInLine!.id).toBe('nearcore-2.13.2');
    expect(getRelease('nearcore-1.40.0')!.latestOfProduct!.id).toBe('nearcore-2.14.0');
    expect(getRelease('nearcore-2.14.0')!.html).not.toContain('Release of');
  });

  it('filters by product, counts every product, and keeps a page number in range', () => {
    const p = getReleases({ product: 'nearcore', page: 99, perPage: 3 });
    expect(p).toMatchObject({ total: 5, page: 2, totalPages: 2 });
    expect(p.counts.nearcore).toBe(5);
    expect(p.counts['near-sdk']).toBe(2);
    expect(p.counts['near-api-js']).toBe(2);
    expect(getReleases({ product: 'bogus' }).total).toBe(9);
  });

  it('gives the current stable version of each product with its older lines', () => {
    const node = currentReleases().find(c => c.product.key === 'nearcore')!;
    expect(node.latest).toMatchObject({ version: '2.14.0', id: 'nearcore-2.14.0' });
    expect(node.lines.map(l => [l.label, l.version])).toEqual([['1.x', '1.40.0']]);
    const sdk = currentReleases().find(c => c.product.key === 'near-sdk')!;
    expect(sdk.latest).toMatchObject({ version: '5.30.0', id: 'near-sdk-5.30.0' });
    expect(currentReleases().find(c => c.product.key === 'mpc')!.latest).toBeNull();
  });
});
