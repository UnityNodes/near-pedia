import type Database from 'better-sqlite3';
import type { PackageSnapshot, Registry, VersionSnapshot } from './registry-packages';

interface PackageRow {
  id: string;
  registry: Registry;
  name: string;
  description: string | null;
  latest_version: string | null;
  latest_published_at: string | null;
  latest_stable_version: string | null;
  deprecated: string | null;
  repository_url: string | null;
  homepage: string | null;
  registry_url: string;
  modified_at: string | null;
}

interface VersionRow {
  version: string;
  published_at: string | null;
  deprecated: string | null;
  yanked: number;
  yank_message: string | null;
}

export function loadPackage(db: Database.Database, id: string): PackageSnapshot | null {
  const row = db.prepare(`SELECT id, registry, name, description, latest_version, latest_published_at, latest_stable_version,
      deprecated, repository_url, homepage, registry_url, modified_at FROM packages WHERE id = ?`).get(id) as PackageRow | undefined;
  if (!row) return null;
  const versions = (db.prepare('SELECT version, published_at, deprecated, yanked, yank_message FROM package_versions WHERE package_id = ?')
    .all(id) as VersionRow[]).map((v): VersionSnapshot => ({ ...v, yanked: v.yanked === 1 }));
  return { ...row, versions };
}

/** Replace one package and its version list in a single transaction. */
export function savePackage(db: Database.Database, p: PackageSnapshot, discoveredBy: string, now: string): void {
  db.transaction(() => {
    db.prepare(`
      INSERT INTO packages (id, registry, name, description, latest_version, latest_published_at, latest_stable_version,
        deprecated, repository_url, homepage, registry_url, versions_count, modified_at, discovered_by, synced_at)
      VALUES (@id, @registry, @name, @description, @latest_version, @latest_published_at, @latest_stable_version,
        @deprecated, @repository_url, @homepage, @registry_url, @versions_count, @modified_at, @discovered_by, @synced_at)
      ON CONFLICT(id) DO UPDATE SET
        description = excluded.description, latest_version = excluded.latest_version,
        latest_published_at = excluded.latest_published_at, latest_stable_version = excluded.latest_stable_version,
        deprecated = excluded.deprecated, repository_url = excluded.repository_url, homepage = excluded.homepage,
        registry_url = excluded.registry_url, versions_count = excluded.versions_count, modified_at = excluded.modified_at,
        discovered_by = excluded.discovered_by, synced_at = excluded.synced_at
    `).run({
      id: p.id, registry: p.registry, name: p.name, description: p.description,
      latest_version: p.latest_version, latest_published_at: p.latest_published_at,
      latest_stable_version: p.latest_stable_version, deprecated: p.deprecated,
      repository_url: p.repository_url, homepage: p.homepage, registry_url: p.registry_url,
      versions_count: p.versions.length, modified_at: p.modified_at, discovered_by: discoveredBy, synced_at: now,
    });
    db.prepare('DELETE FROM package_versions WHERE package_id = ?').run(p.id);
    const ins = db.prepare(`INSERT INTO package_versions (package_id, version, published_at, deprecated, yanked, yank_message)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const v of p.versions) ins.run(p.id, v.version, v.published_at, v.deprecated, v.yanked ? 1 : 0, v.yank_message);
  })();
}

/** Package names a scope was last seen with, so a failed discovery keeps them instead of dropping them. */
export function knownScopePackages(db: Database.Database, scope: string): string[] {
  return (db.prepare("SELECT name FROM packages WHERE registry = 'npm' AND discovered_by = ? ORDER BY name").all(`scope:${scope}`) as { name: string }[])
    .map((r) => r.name);
}
