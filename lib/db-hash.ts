/**
 * A hash of what the database knows, not of its file: SQLite rewrites pages,
 * vacuums and reorders free space without the content changing, so the file
 * bytes would differ between two copies holding the same rows.
 *
 * Per table: every row as a typed JSON array of its column values, rows in
 * the order of all columns, hashed with SHA-256. Whole database: SHA-256 of
 * one `table rows hash` line per table, tables by name. Integers are read
 * exactly (as bigint), blobs as hex, so the same rows give the same hash on
 * any machine.
 *
 * Every table is either hashed or named in NOT_HASHED with the reason, and
 * an unnamed new table is hashed: leaving one out has to be a decision.
 */

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export const NOT_HASHED: Readonly<Record<string, string>> = {
  alert_state: 'operational: which alerts were last sent',
  cip_alert_sent: 'operational: notification bookkeeping',
  contact_submissions: 'visitor submissions: personal data, never published',
  csp_violation_log: 'operational: browser security reports',
  db_anchors: 'the record of these hashes itself',
  embedding_doc_hash: 'derived: which documents were embedded',
  failure_events: 'operational: crash and failure log',
  http_validators: 'operational: ETag and Last-Modified cache',
  log_rollup: 'operational: request-log aggregates',
  mcp_calls: 'operational: per-call MCP log',
  search_log: 'visitor queries: personal data, never published',
  sync_log: 'operational: run log of the syncs',
  sync_state: 'operational: sync watermarks',
  trending_snapshot: 'derived: recomputed every 5 minutes from hashed tables',
};

/** Prefixes of derived tables: full-text indexes, embeddings and their sqlite-vec shadow tables. */
const DERIVED_PREFIXES = ['embedding_'];

export interface TableHash { table: string; rows: number; hash: string }
export interface DbHash { hash: string; tables: TableHash[]; rows: number }

function encode(v: unknown): unknown {
  if (typeof v === 'number' && !Number.isFinite(v)) return { f: String(v) };
  if (v === null || typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'bigint') return { i: v.toString() };
  if (Buffer.isBuffer(v)) return { b: v.toString('hex') };
  return { x: String(v) };
}

/** The tables hashed, by name, and the ones skipped with why. */
export function hashedTables(db: Database.Database): { hashed: string[]; skipped: Array<{ table: string; why: string }> } {
  const all = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string; sql: string | null }>;
  const virtual = all.filter((t) => /^CREATE VIRTUAL TABLE/i.test(t.sql ?? '')).map((t) => t.name);
  const hashed: string[] = [];
  const skipped: Array<{ table: string; why: string }> = [];
  for (const t of all) {
    const ofVirtual = virtual.find((v) => t.name === v || t.name.startsWith(`${v}_`));
    if (ofVirtual) skipped.push({ table: t.name, why: `derived: full-text or vector index (${ofVirtual})` });
    else if (DERIVED_PREFIXES.some((p) => t.name.startsWith(p))) skipped.push({ table: t.name, why: 'derived: embeddings of hashed text' });
    else if (NOT_HASHED[t.name]) skipped.push({ table: t.name, why: NOT_HASHED[t.name] });
    else hashed.push(t.name);
  }
  return { hashed, skipped };
}

const quoteId = (s: string) => `"${s.replace(/"/g, '""')}"`;

export function hashTable(db: Database.Database, table: string): TableHash {
  const cols = (db.prepare(`PRAGMA table_info(${quoteId(table)})`).all() as Array<{ name: string }>).map((c) => quoteId(c.name));
  const stmt = db.prepare(`SELECT ${cols.join(', ')} FROM ${quoteId(table)} ORDER BY ${cols.join(', ')}`).raw(true).safeIntegers(true);
  const h = createHash('sha256');
  let rows = 0;
  for (const row of stmt.iterate() as IterableIterator<unknown[]>) {
    h.update(JSON.stringify(row.map(encode)));
    h.update('\n');
    rows++;
  }
  return { table, rows, hash: h.digest('hex') };
}

/**
 * Inside one read transaction, so the tables come from one snapshot even
 * when a sync writes between them; anchor-db hashes a VACUUM INTO copy,
 * which is consistent by construction and is kept for --verify.
 */
export function hashDatabase(db: Database.Database): DbHash {
  return db.transaction(() => {
    const tables = hashedTables(db).hashed.map((t) => hashTable(db, t));
    const top = createHash('sha256');
    for (const t of tables) top.update(`${t.table} ${t.rows} ${t.hash}\n`);
    return { hash: top.digest('hex'), tables, rows: tables.reduce((n, t) => n + t.rows, 0) };
  })();
}
