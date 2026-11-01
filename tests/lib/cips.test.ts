import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '@/lib/db';
import { getCips, getCipById, getDistinctStatuses, getDistinctTypes } from '@/lib/cips';
import { rebuildFts } from '@/lib/fts';

function insertCip(db: ReturnType<typeof getDb>, overrides: Partial<{
  id: string; cip_number: number; title: string; author: string;
  status: string; type: string; created_date: string; content_md: string;
}> = {}) {
  const id = overrides.id ?? '0001';
  const defaults = {
    id, cip_number: parseInt(id, 10), title: 'Test CIP', author: 'Alice',
    status: 'Active', type: 'Tokenomics', created_date: '2024-01-01',
    approved_date: null, license: 'Apache-2.0', requires: null,
    content_md: '# Test\nSome governance content', synced_at: new Date().toISOString(),
  };
  const row = { ...defaults, ...overrides };
  db.prepare(`
    INSERT INTO cips (id, cip_number, title, author, status, type, created_date,
      approved_date, license, requires, content_md, synced_at)
    VALUES (@id, @cip_number, @title, @author, @status, @type, @created_date,
      @approved_date, @license, @requires, @content_md, @synced_at)
  `).run(row);
}

describe('getCips', () => {
  beforeEach(() => {
    resetDb();
    const db = getDb();
    insertCip(db, { id: '0001', cip_number: 1, title: 'First CIP', status: 'Active', type: 'Tokenomics' });
    insertCip(db, { id: '0002', cip_number: 2, title: 'Second CIP', status: 'Draft', type: 'Protocol' });
    insertCip(db, { id: '0003', cip_number: 3, title: 'Governance Programme', status: 'Active', type: 'Governance', content_md: '# Governance\nThis is about governance' });
    rebuildFts();
  });

  it('returns paginated results with total', () => {
    const result = getCips({});
    expect(result.cips.length).toBe(3);
    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('respects perPage option', () => {
    const result = getCips({ perPage: 2 });
    expect(result.cips.length).toBe(2);
    expect(result.totalPages).toBe(2);
  });

  it('returns page 2 correctly', () => {
    const result = getCips({ perPage: 2, page: 2 });
    expect(result.cips.length).toBe(1);
    expect(result.page).toBe(2);
  });

  it('filters by status', () => {
    const result = getCips({ status: 'Active' });
    expect(result.cips.length).toBe(2);
    expect(result.cips.every(c => c.status === 'Active')).toBe(true);
  });

  it('filters by type', () => {
    const result = getCips({ type: 'Protocol' });
    expect(result.cips.length).toBe(1);
    expect(result.cips[0].type).toBe('Protocol');
  });

  it('filters by status AND type', () => {
    const result = getCips({ status: 'Active', type: 'Tokenomics' });
    expect(result.cips.length).toBe(1);
    expect(result.cips[0].id).toBe('0001');
  });

  it('searches by FTS5 query', () => {
    const result = getCips({ q: 'governance' });
    expect(result.cips.length).toBeGreaterThan(0);
    expect(result.cips.some(c => c.id === '0003')).toBe(true);
  });

  it('search returns empty for no match', () => {
    const result = getCips({ q: 'zzznomatch' });
    expect(result.cips.length).toBe(0);
    expect(result.total).toBe(0);
  });

  it('returns default page 1', () => {
    const result = getCips({});
    expect(result.page).toBe(1);
  });
});

describe('getCipById', () => {
  beforeEach(() => {
    resetDb();
    insertCip(getDb(), { id: '0100', cip_number: 100, title: 'Governance Programme' });
  });

  it('returns correct CIP', () => {
    const cip = getCipById('0100');
    expect(cip).not.toBeNull();
    expect(cip!.title).toBe('Governance Programme');
    expect(cip!.cip_number).toBe(100);
  });

  it('returns null for missing id', () => {
    const cip = getCipById('9999');
    expect(cip).toBeNull();
  });
});

describe('getDistinctStatuses', () => {
  beforeEach(() => {
    resetDb();
    const db = getDb();
    insertCip(db, { id: '0001', status: 'Active' });
    insertCip(db, { id: '0002', status: 'Draft' });
    insertCip(db, { id: '0003', status: 'Active' });
  });

  it('returns unique statuses', () => {
    const statuses = getDistinctStatuses();
    expect(statuses).toContain('Active');
    expect(statuses).toContain('Draft');
    expect(new Set(statuses).size).toBe(statuses.length);
  });
});

describe('getDistinctTypes', () => {
  beforeEach(() => {
    resetDb();
    const db = getDb();
    insertCip(db, { id: '0001', type: 'Tokenomics' });
    insertCip(db, { id: '0002', type: 'Protocol' });
  });

  it('returns unique types', () => {
    const types = getDistinctTypes();
    expect(types).toContain('Tokenomics');
    expect(types).toContain('Protocol');
    expect(new Set(types).size).toBe(types.length);
  });
});
