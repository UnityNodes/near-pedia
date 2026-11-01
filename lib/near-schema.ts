/**
 * Tables for the NEAR sources: package registries, GitHub repository state
 * and the change log every sync writes into.
 *
 * Kept out of lib/db.ts, which holds the engine's own schema, so the NEAR
 * layer reads as one unit and db.ts stays under its size ceiling.
 */

import type Database from 'better-sqlite3';

export function initNearSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS change_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      subject TEXT NOT NULL,
      title TEXT,
      detail TEXT,
      source_url TEXT,
      observed_at TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_change_events_at ON change_events(observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_change_events_subject ON change_events(subject, observed_at DESC);

    CREATE TABLE IF NOT EXISTS packages (
      id TEXT PRIMARY KEY,
      registry TEXT NOT NULL CHECK(registry IN ('npm','crates')),
      name TEXT NOT NULL,
      description TEXT,
      latest_version TEXT,
      latest_published_at TEXT,
      latest_stable_version TEXT,
      deprecated TEXT,
      repository_url TEXT,
      homepage TEXT,
      registry_url TEXT NOT NULL,
      versions_count INTEGER NOT NULL DEFAULT 0,
      modified_at TEXT,
      discovered_by TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_packages_registry ON packages(registry, name);
    CREATE INDEX IF NOT EXISTS idx_packages_repo ON packages(repository_url);

    CREATE TABLE IF NOT EXISTS package_versions (
      package_id TEXT NOT NULL,
      version TEXT NOT NULL,
      published_at TEXT,
      deprecated TEXT,
      yanked INTEGER NOT NULL DEFAULT 0,
      yank_message TEXT,
      PRIMARY KEY (package_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_package_versions_at ON package_versions(package_id, published_at DESC);

    CREATE TABLE IF NOT EXISTS github_repos (
      full_name TEXT PRIMARY KEY,
      org TEXT NOT NULL,
      html_url TEXT NOT NULL,
      description TEXT,
      fork INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      archived_observed_at TEXT,
      pushed_at TEXT,
      created_at TEXT,
      default_branch TEXT,
      stars INTEGER,
      language TEXT,
      topics TEXT,
      homepage TEXT,
      readme_notice TEXT,
      readme_marker TEXT,
      readme_replacement TEXT,
      readme_strength TEXT CHECK(readme_strength IN ('strong','weak')),
      readme_checked_pushed_at TEXT,
      readme_checked_at TEXT,
      synced_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_github_repos_org ON github_repos(org, pushed_at DESC);

    CREATE TABLE IF NOT EXISTS deprecations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('package','crate','repo','rpc_method','protocol','api','service','config','product')),
      status TEXT NOT NULL CHECK(status IN ('removed','deprecated','superseded','changed','possibly_deprecated')),
      strength TEXT NOT NULL CHECK(strength IN ('strong','medium','weak')),
      summary TEXT NOT NULL,
      replacement TEXT,
      replacement_url TEXT,
      since TEXT,
      effective TEXT,
      matchers TEXT NOT NULL,
      subjects TEXT NOT NULL,
      origin TEXT NOT NULL CHECK(origin IN ('seed','signal')),
      stale INTEGER NOT NULL DEFAULT 0,
      contested INTEGER NOT NULL DEFAULT 0,
      built_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_deprecations_kind ON deprecations(kind, status);

    CREATE TABLE IF NOT EXISTS deprecation_evidence (
      deprecation_id TEXT NOT NULL,
      signal TEXT NOT NULL,
      strength TEXT NOT NULL CHECK(strength IN ('strong','medium','weak')),
      source_url TEXT NOT NULL,
      quote TEXT,
      upstream_date TEXT,
      supports INTEGER NOT NULL DEFAULT 1,
      verified INTEGER,
      checked TEXT,
      expired INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (deprecation_id, signal, source_url, quote)
    );

    CREATE TABLE IF NOT EXISTS http_validators (
      url TEXT PRIMARY KEY,
      etag TEXT NOT NULL,
      checked_at TEXT NOT NULL
    );
  `);

  const docCols = db.prepare('PRAGMA table_info(doc_pages)').all() as Array<{ name: string }>;
  if (docCols.length > 0 && !docCols.some((c) => c.name === 'content_hash')) {
    db.exec('ALTER TABLE doc_pages ADD COLUMN content_hash TEXT');
  }
}
