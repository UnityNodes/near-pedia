/**
 * Does each FTS5 index still agree with the table it claims to index?
 *
 * WHY. `check-index-freshness` asks this of the VECTOR half of retrieval and
 * nothing asks it of the keyword half. An external-content FTS5 table does not
 * maintain itself: SQLite stores no copy of the content and re-reads the base
 * table only when told to. A sync that forgets its FTS rebuild trigger, or
 * whose trigger covers only some columns, leaves the index searching stale or
 * missing text while every other check - which reads the base table, not the
 * index - stays green.
 *
 * THE ORACLE, AND THE ONE THAT DOES NOT WORK. FTS5's own 'integrity-check'
 * looks like the answer and is not: it verifies the index against itself, so
 * an index built from stale text passes it every time. This rebuilds each
 * index on a THROWAWAY COPY of the database and compares the vocabulary
 * before and after. A rebuild re-reads the base table, which is precisely the
 * comparison 'integrity-check' declines to make.
 *
 * Read-only with respect to production: the copy is made with VACUUM INTO and
 * deleted afterwards. Nothing here writes to data/cips.db.
 *
 * Cadence: daily. Log: sync_log source='fts-freshness'.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';

/**
 * Every external-content FTS5 index and the table it mirrors.
 *
 * Named explicitly rather than discovered, so ADDING an index is a decision
 * somebody makes here instead of a silence.
 */
const INDEXES: Array<{ fts: string; base: string }> = [
  { fts: 'cips_fts', base: 'cips' },
  { fts: 'forum_fts', base: 'forum_topics' },
  { fts: 'docs_fts', base: 'doc_pages' },
  { fts: 'whitepapers_fts', base: 'whitepapers' },
  { fts: 'cip_attachments_fts', base: 'cip_attachments' },
  { fts: 'embedding_chunks_fts', base: 'embedding_chunks' },
  { fts: 'blog_posts_fts', base: 'blog_posts' },
  { fts: 'foundation_kb_fts', base: 'foundation_kb' },
  { fts: 'youtube_videos_fts', base: 'youtube_videos' },
];

export interface FtsDrift {
  fts: string;
  base: string;
  /** Rows in the base table the index has no entry for at all. */
  neverIndexed: number;
  /** Entries in the index for rows the base table no longer has. */
  ghosts: number;
  /** Rows present in both whose indexed token counts disagree with the row. */
  staleText: number;
  /** Example base-table keys, for the report line. */
  examples: number[];
}

function docIds(db: Database.Database, fts: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const r of db.prepare(`SELECT id, sz FROM "${fts}_docsize"`).all() as Array<{ id: number | bigint; sz: Buffer }>) {
    out.set(Number(r.id), Buffer.from(r.sz).toString('hex'));
  }
  return out;
}

export function measureDrift(snapshotPath: string): FtsDrift[] {
  const db = new Database(snapshotPath);
  const drifts: FtsDrift[] = [];
  try {
    for (const { fts, base } of INDEXES) {
      let before: Map<number, string>;
      try {
        before = docIds(db, fts);
      } catch {
        // An index that does not exist on this deployment is not drift.
        continue;
      }
      db.prepare(`INSERT INTO "${fts}"("${fts}") VALUES('rebuild')`).run();
      const after = docIds(db, fts);

      const neverIndexed: number[] = [];
      const ghosts: number[] = [];
      const staleText: number[] = [];
      for (const [id, sz] of before) {
        if (!after.has(id)) ghosts.push(id);
        else if (after.get(id) !== sz) staleText.push(id);
      }
      for (const id of after.keys()) if (!before.has(id)) neverIndexed.push(id);

      if (neverIndexed.length || ghosts.length || staleText.length) {
        drifts.push({
          fts,
          base,
          neverIndexed: neverIndexed.length,
          ghosts: ghosts.length,
          staleText: staleText.length,
          examples: [...neverIndexed, ...staleText, ...ghosts].slice(0, 5),
        });
      }
    }
  } finally {
    db.close();
  }
  return drifts;
}

function main(): void {
  const dir = mkdtempSync(join(tmpdir(), 'yourpedia-fts-'));
  const snapshot = join(dir, 'snapshot.db');
  const t0 = Date.now();
  try {
    // VACUUM INTO takes a consistent read-only copy without blocking writers.
    // Doing the rebuilds on the live file would be a write to production from
    // a check.
    const live = getDb();
    live.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);

    const drifts = measureDrift(snapshot);
    const total = drifts.reduce((n, d) => n + d.neverIndexed + d.ghosts + d.staleText, 0);

    for (const d of drifts) {
      console.log(
        `  ${d.fts} (content='${d.base}'): ${d.staleText} stale, ${d.neverIndexed} never indexed, ` +
        `${d.ghosts} ghost(s); e.g. ${d.examples.join(', ')}`,
      );
    }

    if (total === 0) {
      console.log(`[check-fts-freshness] ${INDEXES.length} index(es) agree with their tables (${Date.now() - t0}ms)`);
      logRun('fts-freshness', { status: 'success', items: INDEXES.length }, live);
      return;
    }

    const summary = drifts
      .map(d => `${d.fts}: ${d.staleText}+${d.neverIndexed}+${d.ghosts}`)
      .join('; ');
    console.warn(`[check-fts-freshness] ${total} row(s) drifted across ${drifts.length} index(es): ${summary}`);
    console.warn(
      '  Repair is a rebuild of the named index, and the WRITER that skipped it is the real fix:\n' +
      "  npx tsx -e \"require('./lib/db').getDb().exec(\\\"INSERT INTO <fts>(<fts>) VALUES('rebuild')\\\")\"",
    );
    logRun('fts-freshness', { status: 'partial', items: INDEXES.length, error: summary }, live);
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

if (isEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error('[check-fts-freshness] failed:', err);
    try { logRun('fts-freshness', { status: 'error', items: 0, error: String(err).slice(0, 1000) }, getDb()); } catch { /* db down */ }
    process.exit(1);
  }
}
