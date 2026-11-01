/**
 * The change log: one row per thing our syncs saw change upstream (a repo got
 * archived, a package version was yanked, a docs page disappeared). The
 * deprecation engine and get_recent_changes read it.
 *
 * `observed_at` is when a sync saw the change, not when it happened upstream;
 * the two only coincide for sources that carry their own timestamp, and those
 * put it in `detail`. Readers must not present observed_at as the event date.
 */

import type Database from 'better-sqlite3';

export type ChangeKind =
  | 'repo_archived'
  | 'repo_unarchived'
  | 'repo_readme_notice'
  | 'package_deprecated'
  | 'package_undeprecated'
  | 'package_new_latest'
  | 'version_yanked'
  | 'version_deprecated'
  | 'doc_added'
  | 'doc_changed'
  | 'doc_removed'
  | 'deprecation_added'
  | 'protocol_upgraded'
  | 'proposal_created'
  | 'proposal_status_changed'
  | 'incident_added'
  | 'project_added';

export interface ChangeEvent {
  kind: ChangeKind;
  subject: string;
  title: string;
  detail?: Record<string, unknown>;
  source_url?: string | null;
  /**
   * What makes this event the same event on the next run. Without it every
   * sync would re-record "near-sdk-js is archived" as news.
   */
  key: string;
}

export function recordEvents(db: Database.Database, events: readonly ChangeEvent[], observedAt: string): number {
  if (events.length === 0) return 0;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO change_events (kind, subject, title, detail, source_url, observed_at, dedupe_key)
    VALUES (@kind, @subject, @title, @detail, @source_url, @observed_at, @dedupe_key)
  `);
  let written = 0;
  db.transaction(() => {
    for (const e of events) {
      written += insert.run({
        kind: e.kind,
        subject: e.subject,
        title: e.title,
        detail: e.detail ? JSON.stringify(e.detail) : null,
        source_url: e.source_url ?? null,
        observed_at: observedAt,
        dedupe_key: `${e.kind}|${e.subject}|${e.key}`,
      }).changes;
    }
  })();
  return written;
}

export interface ChangeEventRow {
  id: number;
  kind: ChangeKind;
  subject: string;
  title: string | null;
  detail: string | null;
  source_url: string | null;
  observed_at: string;
}

export function recentEvents(db: Database.Database, sinceIso: string, limit: number): ChangeEventRow[] {
  return db.prepare(
    'SELECT id, kind, subject, title, detail, source_url, observed_at FROM change_events WHERE observed_at >= ? ORDER BY observed_at DESC, id DESC LIMIT ?',
  ).all(sinceIso, limit) as ChangeEventRow[];
}
