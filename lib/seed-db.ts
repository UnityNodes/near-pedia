import fs from 'fs';
import type Database from 'better-sqlite3';
import { SEEDS } from './deprecation-seeds';
import { DOCS_ORIGIN } from './near-docs';
import { SOURCE_TABLES, buildEntries, writeEntries } from './deprecation-engine';
import { logRun } from './sync-log';

export const FIXTURE_TABLES = [
  'doc_pages',
  'github_releases',
  'github_repos',
  'packages',
  'package_versions',
  'protocol_snapshots',
  'validator_stakes',
  'validator_votes',
] as const;

export type FixtureTable = (typeof FIXTURE_TABLES)[number];
export type FixtureRow = Record<string, unknown>;

export interface SeedFixture {
  recorded_at: string;
  note?: string;
  tables: Partial<Record<FixtureTable, FixtureRow[]>>;
}

export interface SeedResult {
  rows: Partial<Record<FixtureTable, number>>;
  deprecations: number;
}

const DEMO_PACKAGES = ['npm:near-api-js', 'crates:near-sdk', 'crates:near-workspaces', 'crates:near-jsonrpc-client'];
const DROPPED_COLUMNS: Partial<Record<FixtureTable, readonly string[]>> = { doc_pages: ['id'] };

function citedUrls(): string[] {
  return SEEDS.flatMap((s) => s.evidence.map((e) => e.source_url));
}

function seedPackageIds(): { ids: Set<string>; scopes: string[] } {
  const ids = new Set(DEMO_PACKAGES);
  const scopes: string[] = [];
  for (const s of SEEDS) {
    for (const n of s.matchers.npm ?? []) ids.add(`npm:${n}`);
    for (const n of s.matchers.crates ?? []) ids.add(`crates:${n}`);
    for (const subject of s.subjects) {
      if (subject.startsWith('npm:') || subject.startsWith('crates:')) ids.add(subject);
      if (subject.startsWith('scope:')) scopes.push(`${subject.slice('scope:'.length)}/`);
    }
  }
  return { ids, scopes };
}

function seedRepoNames(): Set<string> {
  return new Set(SEEDS.flatMap((s) => s.subjects.filter((x) => x.startsWith('github:')).map((x) => x.slice('github:'.length))));
}

function strip(table: FixtureTable, rows: FixtureRow[]): FixtureRow[] {
  const drop = DROPPED_COLUMNS[table] ?? [];
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k))));
}

function inList(db: Database.Database, sql: string, values: readonly string[]): FixtureRow[] {
  if (values.length === 0) return [];
  return db.prepare(sql.replace('(?)', `(${values.map(() => '?').join(', ')})`)).all(...values) as FixtureRow[];
}

function protocolRows(db: Database.Database): Pick<SeedFixture['tables'], 'protocol_snapshots' | 'validator_stakes' | 'validator_votes'> {
  const networks = (db.prepare('SELECT DISTINCT network FROM protocol_snapshots ORDER BY network').all() as { network: string }[]).map((r) => r.network);
  const snapshots = networks.flatMap((n) => {
    const latest = db.prepare('SELECT * FROM protocol_snapshots WHERE network = ? ORDER BY observed_at DESC LIMIT 1').get(n) as FixtureRow;
    const previous = db.prepare('SELECT * FROM protocol_snapshots WHERE network = ? AND epoch_id != ? ORDER BY observed_at DESC LIMIT 1').get(n, latest.epoch_id) as FixtureRow | undefined;
    return previous ? [previous, latest] : [latest];
  });
  const epochs = [...new Set(snapshots.map((s) => `${s.network}|${s.epoch_id}`))];
  const byEpoch = (table: 'validator_stakes' | 'validator_votes') => epochs.flatMap((k) => {
    const [network, epoch] = k.split('|');
    return db.prepare(`SELECT * FROM ${table} WHERE network = ? AND epoch_id = ? ORDER BY account_id`).all(network, epoch) as FixtureRow[];
  });
  return { protocol_snapshots: snapshots, validator_stakes: byEpoch('validator_stakes'), validator_votes: byEpoch('validator_votes') };
}

export function extractFixture(db: Database.Database, recordedAt: string): SeedFixture {
  const urls = citedUrls();
  const docUrls = urls.filter((u) => u.startsWith(`${DOCS_ORIGIN}/`));
  const releaseUrls = urls.filter((u) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/tag\//.test(u));
  const { ids, scopes } = seedPackageIds();

  const docs = inList(db, "SELECT * FROM doc_pages WHERE source = 'docs' AND url IN (?) ORDER BY url", docUrls);
  const schedule = db.prepare(`SELECT url FROM github_releases WHERE repo = 'near/nearcore' AND prerelease = 0
    AND body LIKE '%Protocol upgrade voting%' ORDER BY published_at DESC LIMIT 1`).get() as { url: string } | undefined;
  const releases = inList(db, 'SELECT * FROM github_releases WHERE url IN (?) ORDER BY url', [...new Set([...releaseUrls, ...(schedule ? [schedule.url] : [])])]);

  const allPackages = db.prepare('SELECT * FROM packages ORDER BY id').all() as FixtureRow[];
  const packages = allPackages.filter((p) => ids.has(String(p.id)) || scopes.some((s) => String(p.name).startsWith(s)));
  const versions = inList(db, 'SELECT * FROM package_versions WHERE package_id IN (?) ORDER BY package_id, version', packages.map((p) => String(p.id)));

  const repoNames = seedRepoNames();
  const packageRepos = new Set(packages.map((p) => String(p.repository_url ?? '').toLowerCase()).filter(Boolean));
  const repos = (db.prepare('SELECT * FROM github_repos ORDER BY full_name').all() as FixtureRow[])
    .filter((r) => repoNames.has(String(r.full_name)) || packageRepos.has(String(r.html_url).toLowerCase()));

  return {
    recorded_at: recordedAt,
    note: 'Rows copied from a database filled by the live syncs: the docs pages and release notes the curated deprecations quote, the NEAR packages and repositories they name, and the last protocol snapshot per network. Built by scripts/build-seed-fixture.ts, loaded by npm run db:seed.',
    tables: {
      doc_pages: strip('doc_pages', docs),
      github_releases: releases,
      github_repos: repos,
      packages,
      package_versions: versions,
      ...protocolRows(db),
    },
  };
}

export function readFixture(file: string): SeedFixture {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as SeedFixture;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.tables !== 'object') throw new Error(`${file} is not a seed fixture`);
  return parsed;
}

function columnsOf(db: Database.Database, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
}

function insertRows(db: Database.Database, table: FixtureTable, rows: readonly FixtureRow[]): number {
  const allowed = columnsOf(db, table);
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!allowed.has(key)) throw new Error(`fixture ${table}: unknown column ${JSON.stringify(key)}`);
    }
  }
  for (const row of rows) {
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
      .run(...keys.map((k) => row[k] as string | number | null));
  }
  return rows.length;
}

export function seedDatabase(db: Database.Database, fixture: SeedFixture, now: Date = new Date()): SeedResult {
  for (const table of Object.keys(fixture.tables)) {
    if (!(FIXTURE_TABLES as readonly string[]).includes(table)) throw new Error(`${table} is not a fixture table`);
  }
  const filled = [...SOURCE_TABLES, 'protocol_snapshots'].filter((t) => db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get());
  if (filled.length) throw new Error(`${db.name} already holds synced rows (${filled.join(', ')}); the seed only fills a new database: point DB_PATH at a new file, or remove this one to start over`);

  const rows: SeedResult['rows'] = {};
  db.transaction(() => {
    for (const table of FIXTURE_TABLES) {
      const list = fixture.tables[table];
      if (list?.length) rows[table] = insertRows(db, table, list);
    }
  })();

  const entries = buildEntries(db, now);
  writeEntries(db, entries, now.toISOString());
  const total = Object.values(rows).reduce((a, b) => a + (b ?? 0), 0);
  logRun('seed', { status: 'success', items: total }, db);
  return { rows, deprecations: entries.length };
}
