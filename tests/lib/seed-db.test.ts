import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getDb, resetDb } from '@/lib/db';
import { checkCode } from '@/lib/check-code';
import { protocolReport } from '@/lib/protocol';
import { extractFixture, readFixture, seedDatabase, type SeedFixture } from '@/lib/seed-db';

const FIXTURE_PATH = path.resolve(__dirname, '../../scripts/fixtures/near-seed.json');
const NOW = new Date('2026-11-08T12:00:00Z');
const README_CONTRACT = 'import { near } from "near-sdk-js";\nconst a = { DelegateV2: signed };';

function worldRows(): void {
  const db = getDb();
  db.prepare(`INSERT INTO github_repos (full_name, org, html_url, fork, archived, readme_notice, readme_marker, readme_strength, readme_replacement, synced_at)
    VALUES ('near/near-sdk-js', 'near', 'https://github.com/near/near-sdk-js', 0, 1, 'DEPRECATED DO NOT USE', 'DEPRECATED', 'strong', 'https://github.com/near/near-sdk-rs', 't')`).run();
  db.prepare(`INSERT INTO github_repos (full_name, org, html_url, fork, archived, synced_at)
    VALUES ('near/some-experiment', 'near', 'https://github.com/near/some-experiment', 0, 1, 't')`).run();
  db.prepare(`INSERT INTO packages (id, registry, name, latest_version, latest_stable_version, latest_published_at, repository_url, registry_url, discovered_by, synced_at)
    VALUES ('npm:near-sdk-js', 'npm', 'near-sdk-js', '2.0.0', '2.0.0', '2024-06-07T00:00:00Z', 'https://github.com/near/near-sdk-js', 'https://registry/near-sdk-js', 'list', 't')`).run();
  db.prepare(`INSERT INTO packages (id, registry, name, latest_version, latest_stable_version, latest_published_at, repository_url, registry_url, discovered_by, synced_at)
    VALUES ('npm:unrelated-pkg', 'npm', 'unrelated-pkg', '1.0.0', '1.0.0', '2024-06-07T00:00:00Z', null, 'https://registry/x', 'list', 't')`).run();
  db.prepare("INSERT INTO package_versions (package_id, version, published_at, yanked) VALUES ('npm:near-sdk-js', '2.0.0', '2024-06-07T00:00:00Z', 0)").run();
  const doc = db.prepare("INSERT INTO doc_pages (url, title, source, content_text) VALUES (?, 't', 'docs', ?)");
  doc.run('https://docs.near.org/protocol/transactions/meta-tx', 'From protocol version 87 (nearcore 2.14), `DelegateV2` is removed and new transactions containing it are rejected with `RemovedProtocolFeature`.');
  doc.run('https://docs.near.org/some/other-page', 'Nothing a seed quotes.');
  db.prepare(`INSERT INTO github_releases (id, repo, tag, name, body, published_at, url, prerelease, synced_at)
    VALUES ('r', 'near/nearcore', '2.14.0', '2.14.0', ?, '2026-10-26T00:00:00Z', 'https://github.com/near/nearcore/releases/tag/2.14.0', 0, 't')`)
    .run('## Protocol upgrade voting\n\nVoting for protocol version 87 will start on Wednesday November 4th 00:00 UTC.\n');
  db.prepare(`INSERT INTO protocol_snapshots (network, observed_at, chain_id, protocol_version, latest_protocol_version, node_version, block_height, block_time, epoch_id, epoch_height, epoch_start_height, epoch_length, threshold_num, threshold_den, endpoint)
    VALUES ('mainnet', '2026-11-08T05:52:09.611Z', 'mainnet', 88, 88, '2.14.0', 223574406, '2026-11-08T05:52:08.300Z', 'E1', 4948, 223573937, 43200, 4, 5, 'https://free.rpc.fastnear.com')`).run();
  db.prepare("INSERT INTO validator_stakes (network, epoch_id, account_id, stake, block_producer) VALUES ('mainnet', 'E1', 'a.poolv1.near', '1000', 1)").run();
  db.prepare("INSERT INTO validator_votes (network, epoch_id, account_id, voted_version, block_height, block_time) VALUES ('mainnet', 'E1', 'a.poolv1.near', 88, 223573940, '2026-11-08T03:00:00Z')").run();
}

describe('the committed seed fixture', () => {
  beforeEach(() => resetDb());

  it('reproduces both check_code findings the README shows, with no network', () => {
    seedDatabase(getDb(), readFixture(FIXTURE_PATH), NOW);
    const ids = checkCode(getDb(), README_CONTRACT, { filename: 'contract.ts' }).findings.map((f) => [f.line, f.entry?.id]);
    expect(ids).toEqual([[1, 'near-sdk-js'], [2, 'delegate-v2']]);
  });

  it('gives /protocol a mainnet row and the voting schedule from the nearcore release notes', () => {
    seedDatabase(getDb(), readFixture(FIXTURE_PATH), NOW);
    const r = protocolReport(getDb(), ['mainnet'], NOW);
    expect(r.networks).toHaveLength(1);
    expect(r.networks[0].snapshot.protocol_version).toBeGreaterThan(0);
    expect(r.schedule?.steps.length).toBeGreaterThan(0);
  });

  it('stays small enough to commit', () => {
    expect(fs.statSync(FIXTURE_PATH).size).toBeLessThan(3_000_000);
  });
});

describe('seedDatabase', () => {
  beforeEach(() => resetDb());

  it('refuses a database a sync already filled, so a real index is never mixed with the fixture', () => {
    worldRows();
    const fixture = extractFixture(getDb(), NOW.toISOString());
    expect(() => seedDatabase(getDb(), fixture, NOW)).toThrow(/already holds/);
  });

  it('rejects a fixture column the table does not have', () => {
    const bad: SeedFixture = { recorded_at: 'x', tables: { doc_pages: [{ url: 'u', title: 't', source: 'docs', 'content_text) VALUES (1); --': 'x' }] } };
    expect(() => seedDatabase(getDb(), bad, NOW)).toThrow(/unknown column/);
  });

  it('rejects a table outside the fixture set', () => {
    const bad = { recorded_at: 'x', tables: { sync_log: [{ source: 'x' }] } } as unknown as SeedFixture;
    expect(() => seedDatabase(getDb(), bad, NOW)).toThrow(/not a fixture table/);
  });

  it('builds the deprecation index and logs the run', () => {
    worldRows();
    const fixture = extractFixture(getDb(), NOW.toISOString());
    resetDb();
    const out = seedDatabase(getDb(), fixture, NOW);
    expect(out.deprecations).toBeGreaterThan(0);
    const log = getDb().prepare("SELECT status, items_synced FROM sync_log WHERE source = 'seed'").get() as { status: string; items_synced: number };
    expect(log.status).toBe('success');
  });
});

describe('extractFixture', () => {
  beforeEach(() => resetDb());

  it('keeps what the curated entries cite and drops what they do not', () => {
    worldRows();
    const f = extractFixture(getDb(), NOW.toISOString());
    expect(f.tables.doc_pages?.map((r) => r.url)).toEqual(['https://docs.near.org/protocol/transactions/meta-tx']);
    expect(f.tables.github_repos?.map((r) => r.full_name)).toEqual(['near/near-sdk-js']);
    expect(f.tables.packages?.map((r) => r.name)).toEqual(['near-sdk-js']);
    expect(f.tables.package_versions).toHaveLength(1);
    expect(f.tables.github_releases).toHaveLength(1);
    expect(f.tables.protocol_snapshots).toHaveLength(1);
    expect(f.tables.validator_votes).toHaveLength(1);
    expect(f.tables.doc_pages?.[0]).not.toHaveProperty('id');
  });

  it('round-trips: a database seeded from the extract finds what the source database finds', () => {
    worldRows();
    const f = extractFixture(getDb(), NOW.toISOString());
    resetDb();
    seedDatabase(getDb(), f, NOW);
    const ids = checkCode(getDb(), README_CONTRACT, { filename: 'contract.ts' }).findings.map((x) => x.entry?.id);
    expect(ids).toEqual(['near-sdk-js', 'delegate-v2']);
  });
});
