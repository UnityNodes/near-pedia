import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDb } from '@/lib/db';
import { getCips, getNewestCip } from '@/lib/cips';

function addCip(id: string, num: number | null, created: string | null, pr: number | null = null): void {
  getDb().prepare(`
    INSERT INTO cips (id, cip_number, pr_number, title, author, status, type, created_date, synced_at)
    VALUES (?, ?, ?, ?, 'A', 'Draft', 'Governance', ?, '2026-10-01T00:00:00Z')
  `).run(id, num, pr, `Title ${id}`, created);
}

describe('newest first', () => {
  beforeEach(() => {
    resetDb();
    addCip('0001', 1, '2026-01-01');
    addCip('0002', 2, '2026-03-01');
    addCip('0003', 3, '2026-03-01');
    addCip('PR-9', null, '2026-05-01', 9);
    addCip('0004', 4, null);
  });

  it('orders by the day a proposal was created, a pull request without a number among them, and the higher number first on the same day', () => {
    const ids = getCips({ sort: 'newest' }).cips.map(c => c.id);
    expect(ids).toEqual(['PR-9', '0003', '0002', '0001', '0004']);
  });

  it('uses the same order when no sort is asked for', () => {
    expect(getCips({}).cips.map(c => c.id)).toEqual(getCips({ sort: 'newest' }).cips.map(c => c.id));
  });

  it('names as the newest proposal the one the list puts first', () => {
    const newest = getNewestCip();
    expect(newest?.id).toBe(getCips({ sort: 'newest' }).cips[0].id);
    expect(newest).toEqual({ id: 'PR-9', cip_number: null, pr_number: 9, title: 'Title PR-9' });
  });

  it('keeps oldest as the exact opposite for dated proposals', () => {
    const ids = getCips({ sort: 'oldest' }).cips.map(c => c.id);
    expect(ids.slice(0, 2)).toEqual(['0001', '0002']);
  });

  it('has no newest proposal in an empty corpus', () => {
    resetDb();
    expect(getNewestCip()).toBeNull();
  });
});
