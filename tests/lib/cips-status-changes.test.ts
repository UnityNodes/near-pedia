import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDb } from '@/lib/db';
import { getLatestStatusChanges } from '@/lib/cips';

function addCip(id: string, status: string): void {
  getDb().prepare(`
    INSERT INTO cips (id, cip_number, title, author, status, type, created_date, synced_at)
    VALUES (?, ?, 'T', 'A', ?, 'Governance', '2026-01-01', '2026-10-01T00:00:00Z')
  `).run(id, parseInt(id, 10), status);
}

function addChange(cipId: string, from: string | null, to: string, at: string): void {
  getDb().prepare(`INSERT INTO cip_status_history (cip_id, from_status, to_status, changed_at) VALUES (?, ?, ?, ?)`).run(cipId, from, to, at);
}

describe('getLatestStatusChanges', () => {
  beforeEach(() => {
    resetDb();
    addCip('0001', 'Approved');
    addCip('0002', 'Draft');
    addCip('0003', 'Proposed');
    addChange('0001', null, 'Draft', '2026-02-01T10:00:00Z');
    addChange('0001', 'Draft', 'Proposed', '2026-03-01T10:00:00Z');
    addChange('0001', 'Proposed', 'Approved', '2026-04-01T10:00:00Z');
    addChange('0002', null, 'Draft', '2026-05-01T10:00:00Z');
  });

  it('gives the most recent change for each CIP asked about, with where it came from and where it went', () => {
    const map = getLatestStatusChanges(['0001', '0002']);
    expect(map.get('0001')).toEqual({ from: 'Proposed', to: 'Approved', at: '2026-04-01T10:00:00Z' });
    expect(map.get('0002')).toEqual({ from: null, to: 'Draft', at: '2026-05-01T10:00:00Z' });
  });

  it('leaves out a CIP that has no recorded change and ignores CIPs that were not asked about', () => {
    const map = getLatestStatusChanges(['0003']);
    expect(map.size).toBe(0);
    expect(getLatestStatusChanges(['0002']).has('0001')).toBe(false);
  });

  it('breaks a tie on the same instant by the row recorded last', () => {
    addChange('0002', 'Draft', 'Proposed', '2026-05-01T10:00:00Z');
    expect(getLatestStatusChanges(['0002']).get('0002')?.to).toBe('Proposed');
  });

  it('answers an empty question with an empty answer', () => {
    expect(getLatestStatusChanges([]).size).toBe(0);
  });
});
