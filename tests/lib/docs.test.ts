import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '@/lib/db';
import { getDocs, getDocSources, getDocIdByUrl, getDocsGlance, docSourceLabel } from '@/lib/docs';

function insertDoc(db: ReturnType<typeof getDb>, overrides: Partial<{
  id: number; url: string; title: string; breadcrumb: string; excerpt: string;
  content_text: string; source: string; last_modified: string;
}> = {}) {
  const defaults = {
    id: 1,
    url: 'https://docs.example.com/getting-started',
    title: 'Getting Started',
    breadcrumb: 'NEAR SDK > Getting Started',
    excerpt: 'Learn how to set up validator nodes.',
    content_text: 'Learn how to set up validator nodes on NEAR Network.',
    source: 'yourchain-sdk',
    last_modified: '2026-01-01',
  };
  const row = { ...defaults, ...overrides };
  db.prepare(
    'INSERT OR REPLACE INTO doc_pages (id, url, title, breadcrumb, excerpt, content_text, source, last_modified, synced_at) VALUES (@id, @url, @title, @breadcrumb, @excerpt, @content_text, @source, @last_modified, @synced_at)'
  ).run({ ...row, synced_at: new Date().toISOString() });
}

function rebuildDocsFts(db: ReturnType<typeof getDb>) {
  db.prepare("INSERT INTO docs_fts(docs_fts) VALUES(?)").run('rebuild');
}

describe('getDocs', () => {
  beforeEach(() => {
    resetDb();
    const db = getDb();
    insertDoc(db, { id: 1, title: 'Getting Started', breadcrumb: 'NEAR SDK > Getting Started', source: 'yourchain-sdk', content_text: 'Learn how to set up validator nodes on NEAR Network.' });
    insertDoc(db, { id: 2, url: 'https://other-docs.example.com/transaction-semantics', title: 'Transaction Semantics', breadcrumb: 'Other Docs > Core Concepts', source: 'other-docs', content_text: 'Transactions are atomic and consistent.' });
    insertDoc(db, { id: 3, url: 'https://docs.example.com/node-config', title: 'Node Configuration', breadcrumb: 'NEAR SDK > Operations', source: 'yourchain-sdk', content_text: 'Configure your NEAR node with these settings.' });
    rebuildDocsFts(db);
  });

  it('returns paginated results with total', () => {
    const r = getDocs({});
    expect(r.docs.length).toBe(3);
    expect(r.total).toBe(3);
    expect(r.page).toBe(1);
    expect(r.totalPages).toBe(1);
  });

  it('respects perPage', () => {
    const r = getDocs({ perPage: 2 });
    expect(r.docs.length).toBe(2);
    expect(r.totalPages).toBe(2);
  });

  it('returns page 2', () => {
    const r = getDocs({ perPage: 2, page: 2 });
    expect(r.docs.length).toBe(1);
    expect(r.page).toBe(2);
  });

  it('filters by source', () => {
    const r = getDocs({ source: 'yourchain-sdk' });
    expect(r.docs.length).toBe(2);
    expect(r.docs.every(d => d.source === 'yourchain-sdk')).toBe(true);
  });

  it('FTS5 search finds by title', () => {
    const r = getDocs({ q: 'transaction' });
    expect(r.docs.some(d => d.id === 2)).toBe(true);
  });

  it('FTS5 search finds by content_text', () => {
    const r = getDocs({ q: 'validator' });
    expect(r.docs.some(d => d.id === 1)).toBe(true);
  });

  it('FTS5 search returns empty for no match', () => {
    const r = getDocs({ q: 'zzznomatch' });
    expect(r.docs.length).toBe(0);
    expect(r.total).toBe(0);
  });

  it('FTS5 search with source filter', () => {
    const r = getDocs({ q: 'yourchain', source: 'yourchain-sdk' });
    expect(r.docs.every(d => d.source === 'yourchain-sdk')).toBe(true);
  });

  it('sorts by title, letters before paths and versions, when asked to', () => {
    const db = getDb();
    insertDoc(db, { id: 4, url: 'https://docs.example.com/v2/updates', title: '/v2/updates', source: 'yourchain-node' });
    insertDoc(db, { id: 5, url: 'https://docs.example.com/rn/0.10.0', title: '0.10.0', source: 'yourchain-node' });
    const r = getDocs({ sort: 'title' });
    expect(r.docs.map(d => d.title)).toEqual(['Getting Started', 'Node Configuration', 'Transaction Semantics', '/v2/updates', '0.10.0']);
  });

  it('lists the page changed most recently upstream first by default, and undated pages last', () => {
    const db = getDb();
    insertDoc(db, { id: 4, url: 'https://docs.example.com/token-v2', title: 'Token Standard v2', source: 'yourchain-node', last_modified: '2026-10-23T10:19:08.431Z' });
    insertDoc(db, { id: 5, url: 'https://partner.example.org/a', title: 'Alpha', source: 'partner-example-org', last_modified: '' });
    const r = getDocs({});
    expect(r.docs[0].title).toBe('Token Standard v2');
    expect(r.docs[r.docs.length - 1].title).toBe('Alpha');
  });

  it('ranks a title match above a body match', () => {
    const db = getDb();
    insertDoc(db, { id: 4, url: 'https://docs.example.com/onboarding', title: 'Validator Onboarding', breadcrumb: 'Guides', source: 'yourchain-node', content_text: 'Steps.' });
    insertDoc(db, { id: 5, url: 'https://docs.example.com/pm', title: 'Package Manager', breadcrumb: 'Tools', source: 'yourchain-node', content_text: 'The validator onboarding flow uses packages. validator onboarding validator onboarding.' });
    rebuildDocsFts(db);
    expect(getDocs({ q: 'validator onboarding' }).docs[0].title).toBe('Validator Onboarding');
  });

  it('keeps or drops a set of sources, so a kind can be filtered', () => {
    expect(getDocs({ sources: { include: ['other-docs'] } }).docs.map(d => d.id)).toEqual([2]);
    expect(getDocs({ sources: { exclude: ['other-docs'] } }).docs.every(d => d.source !== 'other-docs')).toBe(true);
    expect(getDocs({ sources: { include: [] } }).total).toBe(0);
  });

  it('answers a page far past the end, or too large for SQLite, with no rows instead of an error', () => {
    expect(getDocs({ page: 9999 }).docs).toEqual([]);
    expect(() => getDocs({ page: 1e20 })).not.toThrow();
    expect(() => getDocs({ q: 'yourchain', page: 1e20 })).not.toThrow();
  });

  it('hands search results the head of the text for a snippet', () => {
    const r = getDocs({ q: 'transaction' });
    expect(r.docs[0].body_head).toContain('atomic');
  });
});

describe('getDocSources', () => {
  beforeEach(() => {
    resetDb();
    const db = getDb();
    insertDoc(db, { id: 1, source: 'yourchain-sdk' });
    insertDoc(db, { id: 2, url: 'https://other-docs.example.com/t2', source: 'other-docs' });
    insertDoc(db, { id: 3, url: 'https://docs.example.com/t3', source: 'yourchain-sdk' });
  });

  it('returns sources with counts sorted by count DESC', () => {
    const sources = getDocSources();
    expect(sources.length).toBe(2);
    expect(sources[0].source).toBe('yourchain-sdk');
    expect(sources[0].count).toBe(2);
    expect(sources.find(s => s.source === 'other-docs')?.count).toBe(1);
  });

  it('counts the matches per source when there is a query, so a pill never promises pages the search will not show', () => {
    rebuildDocsFts(getDb());
    const db = getDb();
    db.prepare("UPDATE doc_pages SET content_text = 'only here: quorum' WHERE id = 2").run();
    rebuildDocsFts(db);
    expect(getDocSources('quorum')).toEqual([{ source: 'other-docs', count: 1, url: 'https://other-docs.example.com/t2' }]);
  });
});

describe('getDocsGlance', () => {
  beforeEach(() => { resetDb(); });

  it('counts the pages whose text changed upstream in the last seven days, not the ones first read then', () => {
    const db = getDb();
    insertDoc(db, { id: 1, url: 'https://docs.example.com/a', title: 'Old', last_modified: '2026-10-22T00:00:00Z' });
    insertDoc(db, { id: 2, url: 'https://docs.example.com/b', title: 'Fresh', last_modified: '2026-10-22T00:00:00Z' });
    insertDoc(db, { id: 3, url: 'https://docs.example.com/c', title: 'Also fresh', last_modified: '2026-10-22T00:00:00Z' });
    const ev = db.prepare('INSERT INTO change_events (kind, subject, observed_at, dedupe_key) VALUES (?, ?, ?, ?)');
    ev.run('doc_changed', 'doc:https://docs.example.com/b', '2026-10-23T10:00:00Z', 'b1');
    ev.run('doc_added', 'doc:https://docs.example.com/c', '2026-10-20T10:00:00Z', 'c1');
    ev.run('doc_changed', 'doc:https://docs.example.com/a', '2026-09-01T00:00:00Z', 'a1');
    const g = getDocsGlance(new Date('2026-10-24T12:00:00Z'));
    expect(g.updatedThisWeek).toBe(2);
    expect(g.newest).toEqual({ id: 2, title: 'Fresh', last_modified: '2026-10-23T10:00:00Z' });
    expect(g.synced).not.toBeNull();
  });
});

describe('docSourceLabel', () => {
  it('names a known source, falls back to the host the pages live on, and only then to the slug', () => {
    expect(docSourceLabel('docs')).toBe('docs.near.org');
    expect(docSourceLabel('www-partner-example-org', 'https://www.partner.example.org/docs/x')).toBe('partner.example.org');
    expect(docSourceLabel('docs-tools-example-net', 'https://docs.tools.example.net/')).toBe('docs.tools.example.net');
    expect(docSourceLabel('new-source')).toBe('New Source');
    expect(docSourceLabel('new-source', 'not a url')).toBe('New Source');
  });
});

describe('getDocIdByUrl', () => {
  beforeEach(() => { resetDb(); });

  it('finds a page by its address, whatever id the table gave it', () => {
    const db = getDb();
    insertDoc(db, { id: 4242, url: 'https://docs.example.com/appdev/quickstart', title: 'QuickStart' });
    expect(getDocIdByUrl('https://docs.example.com/appdev/quickstart')).toBe(4242);
  });

  it('answers null for an address that is not held, and the lowest id when two rows share one', () => {
    const db = getDb();
    insertDoc(db, { id: 9, url: 'https://docs.example.com/a', title: 'A' });
    insertDoc(db, { id: 5, url: 'https://docs.example.com/a', title: 'A again' });
    expect(getDocIdByUrl('https://docs.example.com/missing')).toBeNull();
    expect(getDocIdByUrl('https://docs.example.com/a')).toBe(5);
  });
});
