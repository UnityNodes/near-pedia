import type Database from 'better-sqlite3';

/** The ETag a URL last answered with, for a conditional re-request. */
export function storedEtag(db: Database.Database, url: string): string | null {
  return (db.prepare('SELECT etag FROM http_validators WHERE url = ?').get(url) as { etag: string } | undefined)?.etag ?? null;
}

export function storeEtag(db: Database.Database, url: string, etag: string | null, now: string): void {
  if (!etag) {
    db.prepare('DELETE FROM http_validators WHERE url = ?').run(url);
    return;
  }
  db.prepare(`INSERT INTO http_validators (url, etag, checked_at) VALUES (?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET etag = excluded.etag, checked_at = excluded.checked_at`).run(url, etag, now);
}
