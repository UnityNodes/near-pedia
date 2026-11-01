import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, resetDb } from '@/lib/db';
import { RELEASE_PRODUCTS, currentReleases, findRelease, getRelease, getReleases, releaseFeed } from '@/lib/releases';

const SYNCED = '2026-10-25T00:00:00Z';

function seed() {
  const ins = getDb().prepare('INSERT INTO github_releases (id, repo, tag, name, body, published_at, url, prerelease, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const rel = (id: string, repo: string, tag: string, date: string, body = '', prerelease = 0) =>
    ins.run(id, repo, tag, tag, body, date, `https://github.com/${repo}/releases/tag/${tag}`, prerelease, SYNCED);
  rel('101', 'your-org/yourchain-node', 'v1.4.2', '2026-10-22T12:00:00Z', '# Release of yourchain-node 1.4.2\n\n## Summary\n\nThis maintenance release fixes slow state sync on large databases.');
  rel('102', 'your-org/yourchain-node', 'v1.4.1', '2026-10-15T12:00:00Z', '## Summary\n\nThis patch release fixes a stalled peer handshake after restart.');
  rel('103', 'your-org/yourchain-node', 'v1.5.0-testnet', '2026-10-24T12:00:00Z', '## Summary\n\nTestnet build of the next minor release, with the new state store.', 1);
  rel('104', 'your-org/yourchain-node', 'v0.9.8', '2026-08-01T12:00:00Z', '## Summary\n\nThe last maintenance release of the 0.x line before the 1.0 cutover.');
  rel('201', 'your-org/yoursdk', 'v3.2.0', '2026-10-20T12:00:00Z');
  rel('301', 'other-org/unrelated', 'v9.9.9', '2026-10-25T12:00:00Z');
}

describe('the release feed', () => {
  beforeEach(() => { resetDb(); seed(); });

  it('lists every release of the configured repos newest first under ids of their own, pre-releases marked', () => {
    expect(releaseFeed().map(i => [i.id, i.prerelease])).toEqual([
      ['yourchain-node-1.5.0-testnet', true],
      ['yourchain-node-1.4.2', false],
      ['yoursdk-3.2.0', false],
      ['yourchain-node-1.4.1', false],
      ['yourchain-node-0.9.8', false],
    ]);
    expect(RELEASE_PRODUCTS.map(p => p.key)).toContain('yourchain-node');
  });

  it('reads the summary from the notes and finds a release by the id of its old blog mirror', () => {
    expect(findRelease('yourchain-node-1.4.2')!.summary).toBe('This maintenance release fixes slow state sync on large databases.');
    expect(findRelease('rel-101')!.id).toBe('yourchain-node-1.4.2');
    expect(findRelease('nope')).toBeNull();
  });

  it('marks the newest stable release of each line, never a pre-release', () => {
    expect(findRelease('yourchain-node-1.4.2')!.latestInLine).toBe(true);
    expect(findRelease('yourchain-node-1.4.1')!.latestInLine).toBe(false);
    expect(findRelease('yourchain-node-1.5.0-testnet')!.latestInLine).toBe(false);
  });

  it('gives a release its notes without the duplicate title, its line, and the newest stable release of its product', () => {
    const d = getRelease('yourchain-node-1.4.1')!;
    expect(d.html).not.toContain('Release of');
    expect(d.inLine.map(i => i.version)).toEqual(['1.4.2', '1.4.1']);
    expect(d.latestInLine!.id).toBe('yourchain-node-1.4.2');
    expect(getRelease('yourchain-node-0.9.8')!.latestOfProduct!.id).toBe('yourchain-node-1.4.2');
  });

  it('filters by product, counts every product, and keeps a page number in range', () => {
    const p = getReleases({ product: 'yourchain-node', page: 99, perPage: 3 });
    expect(p).toMatchObject({ total: 4, page: 2, totalPages: 2 });
    expect(p.counts['yourchain-node']).toBe(4);
    expect(p.counts.yoursdk).toBe(1);
    expect(getReleases({ product: 'bogus' }).total).toBe(5);
  });

  it('gives the current stable version of each product with its older lines', () => {
    const node = currentReleases().find(c => c.product.key === 'yourchain-node')!;
    expect(node.latest).toMatchObject({ version: '1.4.2', id: 'yourchain-node-1.4.2' });
    expect(node.lines.map(l => [l.label, l.version])).toEqual([['0.x', '0.9.8']]);
    expect(currentReleases().find(c => c.product.key === 'yourchain-app')!.latest).toBeNull();
  });
});
