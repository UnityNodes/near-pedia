import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDb } from '@/lib/db';
import { catalogCategories, findProjects, resolveCategory } from '@/lib/ecosystem-read';

function seed() {
  const db = getDb();
  const ins = db.prepare(`INSERT INTO ecosystem_projects (slug, title, tagline, description, category, tags, url, source, synced_at, tvl_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'nearcatalog.xyz', '2026-11-02T00:00:00Z', ?)`);
  ins.run('near-intents', 'NEAR Intents', 'Cross-chain swaps settled by solvers', 'Intents-based swaps across chains', 'DeFi', 'intents,swap', 'https://x/1', 111_000_000);
  ins.run('leodex', 'LeoDex', 'Swap aggregator built on NEAR Intents', 'A DEX', 'DEX', 'dex', 'https://x/2', null);
  ins.run('hot-wallet', 'HOT Wallet', 'Wallet for Telegram', 'A wallet', 'Wallet', 'wallet', 'https://x/3', null);
  ins.run('meteor', 'Meteor Wallet', 'Self-custodial wallet', 'A wallet', 'Wallet', 'wallet', 'https://x/4', null);
}

describe('find_project search', () => {
  beforeEach(() => { resetDb(); seed(); });

  it('finds projects by most of the words when the whole phrase is in no listing', () => {
    expect(findProjects(getDb(), 'intents swap', { limit: 5 }).map((r) => r.slug)).toEqual(['near-intents', 'leodex']);
  });

  it('keeps an exact name first', () => {
    expect(findProjects(getDb(), 'meteor wallet', { limit: 5 })[0].slug).toBe('meteor');
  });

  it('reads a category in any case, singular or plural, and lists the categories', () => {
    expect(resolveCategory(getDb(), 'wallets')).toBe('Wallet');
    expect(resolveCategory(getDb(), 'defi')).toBe('DeFi');
    expect(resolveCategory(getDb(), 'gaming')).toBeNull();
    expect(catalogCategories(getDb())[0]).toEqual({ category: 'Wallet', n: 2 });
  });
});
