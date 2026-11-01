import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDb } from '@/lib/db';
import { knownScopePackages, loadPackage, savePackage } from '@/lib/packages-store';
import { diffPackage, fromCrates, fromNpm } from '@/lib/registry-packages';
import { recordEvents, recentEvents } from '@/lib/change-events';

const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'near', name), 'utf8'));

describe('packages store', () => {
  beforeEach(() => resetDb());

  it('round-trips a package and its versions', () => {
    const p = fromCrates(fixture('crate-near-jsonrpc-client.json'));
    savePackage(getDb(), p, 'list', '2026-11-01T00:00:00Z');
    expect(loadPackage(getDb(), p.id)).toEqual(p);
  });

  it('replaces the version list instead of accumulating it', () => {
    const db = getDb();
    const p = fromNpm(fixture('npm-near-sdk-js.json'));
    savePackage(db, p, 'list', 't1');
    savePackage(db, { ...p, versions: p.versions.slice(0, 2) }, 'list', 't2');
    expect(loadPackage(db, p.id)?.versions).toHaveLength(2);
    expect((db.prepare('SELECT versions_count c FROM packages WHERE id = ?').get(p.id) as { c: number }).c).toBe(2);
  });

  it('remembers which packages a scope discovered', () => {
    const db = getDb();
    savePackage(db, fromNpm(fixture('npm-near-js-accounts.json')), 'scope:@near-js', 't');
    savePackage(db, fromNpm(fixture('npm-near-api-js.json')), 'list', 't');
    expect(knownScopePackages(db, '@near-js')).toEqual(['@near-js/accounts']);
  });

  it('records a diff once, however many runs see it', () => {
    const db = getDb();
    const before = fromCrates(fixture('crate-near-jsonrpc-client.json'));
    savePackage(db, before, 'list', 't1');
    const after = { ...before, latest_version: '0.24.0' };
    const events = diffPackage(loadPackage(db, before.id), after);
    expect(recordEvents(db, events, '2026-11-01T01:00:00Z')).toBe(1);
    expect(recordEvents(db, events, '2026-11-01T02:00:00Z')).toBe(0);
    const [row] = recentEvents(db, '2026-11-01T00:00:00Z', 10);
    expect(row.kind).toBe('package_new_latest');
    expect(row.observed_at).toBe('2026-11-01T01:00:00Z');
  });
});
