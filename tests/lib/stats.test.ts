import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '@/lib/db';
import { getSiteStats } from '@/lib/stats';

describe('getSiteStats', () => {
  beforeEach(() => {
    resetDb();
  });

  it('returns zero counts for empty DB', () => {
    const stats = getSiteStats();
    expect(stats.topics).toBe(0);
    expect(stats.docs).toBe(0);
  });

  it('counts forum_topics correctly', () => {
    const db = getDb();
    db.prepare('INSERT INTO forum_topics (id, title, category_id, created_at, last_post_at, url, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(1, 'Test Topic', 57, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'https://gov.near.org/t/test/1', new Date().toISOString());
    const stats = getSiteStats();
    expect(stats.topics).toBe(1);
  });

  it('counts doc_pages correctly', () => {
    const db = getDb();
    db.prepare('INSERT INTO doc_pages (url, title, source, synced_at) VALUES (?, ?, ?, ?)').run('https://docs.example.com/test', 'Test Doc', 'docs', new Date().toISOString());
    const stats = getSiteStats();
    expect(stats.docs).toBe(1);
  });
});
