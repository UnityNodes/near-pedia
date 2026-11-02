/**
 * Delete local rows whose upstream key is gone, with the guards that make that
 * safe.
 *
 * WHY THIS IS SHARED. A provenance audit on 2026-07-30 found 18 tables in the
 * NO-PRUNE class, and the cause was not carelessness: pruning was opt-in per
 * script with no helper, so the four writers that got it right each invented
 * their own guard. One history sync did DELETE-then-reinsert,
 * lib/kb-drift.ts deletes what the current findings do not contain,
 * the calendar sync deletes what the run did not see but only if the parse was
 * non-empty, and sync-validator-registry refuses outright if more than a
 * quarter of the fleet would vanish. Four correct answers, no reuse, and
 * fourteen tables with no answer at all.
 *
 * THE TWO FAILURE MODES, which pull in opposite directions:
 *
 *   Never pruning leaves 1209 dead documentation URLs (39% of that corpus)
 *   answering search and MCP as current, which is what happened here.
 *
 *   Pruning without a guard turns one bad fetch into a wiped corpus: an empty
 *   sitemap, a 503, or an auth expiry all look exactly like "upstream deleted
 *   everything".
 *
 * So: refuse on an empty key set, and refuse when the deletion is large enough
 * that a blip is the likelier explanation. A refusal is REPORTED, not silent.
 * The whole reason the dead documentation survived 15 days is that its prune
 * threw a foreign-key error into a per-source catch that logged to the console
 * and then wrote 'success' anyway, 59 runs in a row.
 *
 * A large deletion that is genuinely correct is a deliberate act with evidence
 * behind it, not a loosened default.
 */

import type Database from 'better-sqlite3';
import { getDb } from './db';

export interface PruneSpec {
  /** Table to delete from. */
  table: string;
  /** Column holding the upstream identity, e.g. 'url' or 'id'. */
  keyColumn: string;
  /**
   * SQL expression for a composite identity, used instead of keyColumn. Several
   * tables key on more than one column, e.g. (category, key), and
   * quoting a bare identifier cannot express that. The caller must build the
   * matching liveKeys the same way. NUL is the separator convention here because
   * it cannot occur in any upstream value.
   *
   *   keyExpr: `category || char(0) || key`
   *   liveKeys: rows.map(r => `${r.category}\u0000${r.key}`)
   *
   * That escape used to be a RAW NUL byte in this comment, which made git
   * classify the whole file as binary: no reviewable diff, on a file shared
   * with other repositories. It compiled, so nothing complained.
   */
  keyExpr?: string;
  /** Restrict the prune to one slice of a shared table, e.g. source='docs'. */
  scopeColumn?: string;
  scopeValue?: string | number;
  /**
   * Keys seen in THIS run, which must come from a fetch that succeeded. Passing
   * the keys of a partial fetch is the one way to misuse this.
   */
  liveKeys: readonly string[];
  /**
   * Refuse if the deletion would remove more than this share of the in-scope
   * rows. 0.25 matches the guard sync-validator-registry arrived at
   * independently. Raise it only with evidence that the rows are really gone.
   */
  maxDeleteRatio?: number;
  /**
   * Deletions at or below this many rows skip the ratio check entirely.
   *
   * A percentage is meaningless on a small scope. A repo with three stored
   * releases where upstream now publishes one trips the 25% guard at 67% and
   * refuses forever, so the two dead rows are never removed and the source sits
   * permanently at partial. Two rows is not the shape of a broken fetch by any
   * reading; a wiped corpus is a large number, and this floor is what separates
   * the two.
   */
  minDeleteAlways?: number;
  /**
   * Extra SQL predicate limiting which rows are even considered.
   *
   * Needed when the fetch is a WINDOW rather than the whole set: a release sync
   * that keeps two years of history has a complete picture of that window and
   * none at all of what precedes it, so the prune has to be confined to the same
   * window or it deletes the archive it never asked about.
   *
   *   scopeWhere: "published_at >= datetime('now', '-730 days')"
   */
  scopeWhere?: string;
  /**
   * Clear rows in other tables that reference the doomed ones, so a foreign key
   * cannot abort the delete. Runs inside the same transaction, and receives the
   * name of a temp table holding the keys about to go.
   */
  clearReferences?: (db: Database.Database, doomedKeysTable: string) => void;
  /**
   * Report the doomed keys and delete nothing.
   *
   * Exists so a caller can answer the question the ratio guard only guesses at.
   * The guard refuses a large deletion because "upstream may be broken rather
   * than emptied" — a caller holding URLs can go and ASK, then come back with
   * `confirmedGone`. Nothing else about the run changes.
   */
  dryRun?: boolean;
  /**
   * Keys the caller has independently proven are gone upstream, e.g. a URL that
   * now answers 404.
   *
   * They are still deleted; they simply do not count toward the ratio, because
   * the ratio exists to ask whether upstream is broken and these already have an
   * answer. This is the "deliberate act with evidence behind it" this module's
   * header asks for, as opposed to raising maxDeleteRatio, which discards the
   * guard for every future run as well.
   *
   * Found the hard way: docs.noves.fi renamed 26 of 83 reference pages on
   * 2026-07-30. Every old URL 404s and 14 of them were already held again under
   * the new path, so the corpus carried both. 26/83 is 31.3%, over the guard, so
   * the prune refused on all 33 runs that followed and the source sat at
   * `partial` for eight days while search returned the dead page above the live
   * one. A rename is neither of the two cases the ratio knows about.
   */
  confirmedGone?: readonly string[];
}

export interface PruneResult {
  deleted: number;
  /** True when a guard stopped the prune. `reason` says which. */
  refused: boolean;
  reason?: string;
  /** In-scope rows before the prune, for the caller's log line. */
  scopeRows: number;
  /**
   * Keys that would be deleted. Always populated, not only on `dryRun`, so a
   * refusal names what it is holding back rather than only how many.
   */
  doomedKeys: string[];
  /**
   * How many of the doomed keys the caller had already proven gone. Reported so
   * the log line distinguishes "we checked" from "the ratio happened to pass",
   * which read identically before.
   */
  confirmed: number;
}

const LIVE = '_prune_live';
const DOOMED = '_prune_doomed';

export function prune(spec: PruneSpec, dbOverride?: Database.Database): PruneResult {
  const db = dbOverride ?? getDb();
  const { table, keyColumn, scopeColumn, scopeValue, liveKeys } = spec;
  const maxRatio = spec.maxDeleteRatio ?? 0.25;

  const clauses: string[] = [];
  if (scopeColumn) clauses.push(`"${scopeColumn}" = ?`);
  if (spec.scopeWhere) clauses.push(`(${spec.scopeWhere})`);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const params = scopeColumn ? [scopeValue] : [];
  const scopeRows = (
    db.prepare(`SELECT COUNT(*) AS n FROM "${table}" ${where}`).get(...params) as { n: number }
  ).n;

  // Order matters. Nothing stored means nothing to delete, whatever the fetch
  // returned, so this is a no-op and not a refusal. Checking the empty key set
  // first made every repo with Discussions disabled report a refused prune on
  // every run, which would have put a permanent false 'partial' on the source.
  // A status that is always yellow is read the same way as one that is always
  // green.
  if (scopeRows === 0) return { deleted: 0, refused: false, scopeRows, doomedKeys: [], confirmed: 0 };

  if (liveKeys.length === 0) {
    return {
      deleted: 0,
      refused: true,
      reason: `live key set is empty while ${scopeRows} row(s) are stored, which is indistinguishable from a failed fetch`,
      scopeRows,
      doomedKeys: [],
      confirmed: 0,
    };
  }

  db.exec(`CREATE TEMP TABLE IF NOT EXISTS ${LIVE} (k TEXT PRIMARY KEY)`);
  db.exec(`DELETE FROM ${LIVE}`);
  const insLive = db.prepare(`INSERT OR IGNORE INTO ${LIVE} (k) VALUES (?)`);
  db.transaction(() => {
    for (const k of liveKeys) insLive.run(k);
  })();

  const keySql = spec.keyExpr ?? `"${keyColumn}"`;
  const doomedSql = `SELECT ${keySql} AS k FROM "${table}"
     ${where ? `${where} AND` : 'WHERE'} ${keySql} NOT IN (SELECT k FROM ${LIVE})`;
  const doomedKeys = (db.prepare(doomedSql).all(...params) as { k: string }[]).map(r => r.k);
  const doomed = doomedKeys.length;

  if (doomed === 0) return { deleted: 0, refused: false, scopeRows, doomedKeys: [], confirmed: 0 };

  // Only keys that are actually doomed count. A caller passing its whole live
  // set here by mistake would otherwise zero the ratio and disable the guard.
  const proven = new Set(spec.confirmedGone ?? []);
  const confirmed = doomedKeys.filter(k => proven.has(k)).length;

  if (spec.dryRun) return { deleted: 0, refused: false, scopeRows, doomedKeys, confirmed };

  // The ratio judges the rows nobody has accounted for. A confirmed 404 is not
  // evidence that the fetch broke, so counting it as such is what kept the dead
  // pages served.
  const unexplained = doomed - confirmed;
  const ratio = unexplained / scopeRows;
  if (unexplained > (spec.minDeleteAlways ?? 5) && ratio > maxRatio) {
    return {
      deleted: 0,
      refused: true,
      reason:
        `would delete ${doomed} of ${scopeRows} rows` +
        `${confirmed ? `, ${confirmed} of them confirmed gone` : ''}; ` +
        `the remaining ${unexplained} are ${(ratio * 100).toFixed(1)}% of the scope, ` +
        `over the ${(maxRatio * 100).toFixed(0)}% guard; upstream may be broken rather than emptied`,
      scopeRows,
      doomedKeys,
      confirmed,
    };
  }

  let deleted = 0;
  db.transaction(() => {
    db.exec(`CREATE TEMP TABLE IF NOT EXISTS ${DOOMED} (k TEXT PRIMARY KEY)`);
    db.exec(`DELETE FROM ${DOOMED}`);
    db.prepare(`INSERT OR IGNORE INTO ${DOOMED} (k) ${doomedSql}`).run(...params);
    spec.clearReferences?.(db, DOOMED);
    deleted = db
      .prepare(`DELETE FROM "${table}" WHERE ${keySql} IN (SELECT k FROM ${DOOMED})`)
      .run().changes;
  })();

  return { deleted, refused: false, scopeRows, doomedKeys, confirmed };
}
