import type Database from 'better-sqlite3';
import type { ReadmeNotice, RepoSnapshot, StoredRepo } from './github-repos';

export interface StoredRepoState extends StoredRepo {
  readme_checked_pushed_at: string | null;
  readme_checked_at: string | null;
}

export function loadOrgRepos(db: Database.Database, org: string): Map<string, StoredRepoState> {
  const rows = db.prepare(`SELECT full_name, archived, readme_marker, readme_checked_pushed_at, readme_checked_at
    FROM github_repos WHERE org = ?`).all(org) as StoredRepoState[];
  return new Map(rows.map((r) => [r.full_name, r]));
}

/**
 * Upsert the listing fields. `archived_observed_at` is set the first time a
 * sync sees the repository archived and cleared when it is unarchived; the
 * README columns are left to saveReadme.
 */
export function saveRepo(db: Database.Database, r: RepoSnapshot, now: string): void {
  db.prepare(`
    INSERT INTO github_repos (full_name, org, html_url, description, fork, archived, archived_observed_at, pushed_at,
      created_at, default_branch, stars, language, topics, homepage, synced_at)
    VALUES (@full_name, @org, @html_url, @description, @fork, @archived, @archived_observed_at, @pushed_at,
      @created_at, @default_branch, @stars, @language, @topics, @homepage, @synced_at)
    ON CONFLICT(full_name) DO UPDATE SET
      html_url = excluded.html_url, description = excluded.description, fork = excluded.fork,
      archived = excluded.archived,
      archived_observed_at = CASE
        WHEN excluded.archived = 0 THEN NULL
        WHEN github_repos.archived = 1 THEN github_repos.archived_observed_at
        ELSE excluded.archived_observed_at END,
      pushed_at = excluded.pushed_at, created_at = excluded.created_at, default_branch = excluded.default_branch,
      stars = excluded.stars, language = excluded.language, topics = excluded.topics, homepage = excluded.homepage,
      synced_at = excluded.synced_at
  `).run({
    ...r,
    fork: r.fork ? 1 : 0,
    archived: r.archived ? 1 : 0,
    archived_observed_at: r.archived ? now : null,
    topics: r.topics.length ? JSON.stringify(r.topics) : null,
    synced_at: now,
  });
}

export function saveReadme(db: Database.Database, fullName: string, notice: ReadmeNotice | null, pushedAt: string | null, now: string): void {
  db.prepare(`UPDATE github_repos SET readme_notice = ?, readme_marker = ?, readme_replacement = ?, readme_strength = ?,
      readme_checked_pushed_at = ?, readme_checked_at = ? WHERE full_name = ?`)
    .run(notice?.notice ?? null, notice?.marker ?? null, notice?.replacement ?? null, notice?.strength ?? null, pushedAt, now, fullName);
}
