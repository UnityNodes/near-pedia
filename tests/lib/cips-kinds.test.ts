import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDb } from '@/lib/db';
import { rebuildFts } from '@/lib/fts';
import { getCips, getCipStatusCounts, getCipsTotalCount, getDistinctTypes, getKindCounts, getNewestCip } from '@/lib/cips';

function add(id: string, num: number | null, status: string, created: string, title: string, type: string | null = 'Governance', pr: number | null = null): void {
  getDb().prepare(`
    INSERT INTO cips (id, cip_number, pr_number, title, author, status, type, created_date, content_md, synced_at)
    VALUES (?, ?, ?, ?, 'A', ?, ?, ?, ?, '2026-10-01T00:00:00Z')
  `).run(id, num, pr, title, status, type, created, `# ${title}\nvalidator rewards`);
}

describe('proposals and pull requests', () => {
  beforeEach(() => {
    resetDb();
    add('0001', 1, 'Final', '2026-01-01', 'First proposal', 'Tokenomics');
    add('0002', 2, 'Draft', '2026-02-01', 'Second proposal');
    add('PR-0003', 3, 'In Review', '2026-03-01', 'Third proposal still in a pull request', 'Governance', 30);
    add('PR-9', null, 'Draft', '2026-05-01', 'Open pull request nine', null, 9);
    add('PR-10', null, 'In Review', '2026-06-01', 'readme: add a section', null, 10);
    rebuildFts();
  });

  it('counts a proposal as a row that has a number, even while its file is still in a pull request', () => {
    expect(getKindCounts()).toEqual({ cip: 3, pr: 2 });
    expect(getCipsTotalCount()).toBe(5);
    expect(getCipsTotalCount('cip')).toBe(3);
    expect(getCipsTotalCount('pr')).toBe(2);
  });

  it('lists only proposals, or only pull requests, when asked, and everything when not', () => {
    expect(getCips({ kind: 'cip' }).cips.map(c => c.id).sort()).toEqual(['0001', '0002', 'PR-0003']);
    expect(getCips({ kind: 'pr' }).cips.map(c => c.id)).toEqual(['PR-10', 'PR-9']);
    expect(getCips({}).total).toBe(5);
  });

  it('keeps the kind when a search or a filter is on', () => {
    expect(getCips({ kind: 'pr', q: 'validator' }).cips.map(c => c.id).sort()).toEqual(['PR-10', 'PR-9']);
    expect(getCips({ kind: 'cip', q: 'validator' }).total).toBe(3);
    expect(getCips({ kind: 'cip', status: 'Draft' }).cips.map(c => c.id)).toEqual(['0002']);
    expect(getCips({ kind: 'pr', status: 'Draft' }).cips.map(c => c.id)).toEqual(['PR-9']);
  });

  it('counts statuses per kind', () => {
    const cip = Object.fromEntries(getCipStatusCounts('cip').map(s => [s.status, s.count]));
    const pr = Object.fromEntries(getCipStatusCounts('pr').map(s => [s.status, s.count]));
    expect(cip).toEqual({ Final: 1, Draft: 1, 'In Review': 1 });
    expect(pr).toEqual({ Draft: 1, 'In Review': 1 });
    expect(getCipStatusCounts().reduce((n, s) => n + s.count, 0)).toBe(5);
  });

  it('names the newest proposal without counting a pull request that has no number', () => {
    expect(getNewestCip('cip')?.id).toBe('PR-0003');
    expect(getNewestCip('pr')?.id).toBe('PR-10');
    expect(getNewestCip()?.id).toBe('PR-10');
  });

  it('lists the types of one kind only', () => {
    expect(getDistinctTypes('pr')).toEqual([]);
    expect(getDistinctTypes('cip')).toEqual(['Governance', 'Tokenomics']);
  });
});
