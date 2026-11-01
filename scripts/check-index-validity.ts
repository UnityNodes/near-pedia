/**
 * A row's validity is served with the row; the index does not drop it.
 *
 * Covers the two status-bearing source types this app actually has embedded.
 *
 * THE CLASS. The vector index is flat: semantic_search retrieves a chunk by
 * meaning and renders it from a switch on source_type. A row's VALIDITY - a
 * CIP being Withdrawn, a radar alert being expired - lives in a column that
 * switch reads only if someone wrote the case to. get_cip/list_cips and
 * get_radar filter or show it; semantic_search, the tool an agent actually
 * calls to answer "how does X work", did not: a Withdrawn CIP rendered
 * identically to a Final one (5 of 166 embedded CIPs, found writing this
 * check), and 27 embedded radar_item chunks had NO render case at all -
 * title and url stayed at their empty defaults, not even a validity problem,
 * a missing-content one. Both are fixed alongside this check, not left
 * broken with a check pointed at nothing.
 *
 * WHAT THIS ASSERTS. For each status-bearing source with non-current rows
 * ACTUALLY in the index, the semantic_search render case must read the
 * validity column, so the meta can say the row is superseded. Data (are
 * non-current rows embedded) x code (does the case read the column) - a
 * source with zero non-current rows embedded is not asserted, because there
 * is nothing to mislabel yet; the day one is embedded the count turns this
 * red.
 *
 *   npx tsx scripts/check-index-validity.ts
 */

import fs from 'node:fs';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { repoPath } from '../lib/repo-root';

interface StatusSource {
  type: string; // embedding source_type
  from: string; // FROM clause with alias t
  join: string; // how embedding_chunks.source_id maps to t's id
  nonCurrent: string; // predicate for a row that is no longer authoritative (:now allowed)
  mustRef: RegExp; // the validity column the render case must read
  label: string;
}

const SOURCES: StatusSource[] = [
  {
    type: 'cip', from: 'cips t', join: 'e.source_id = t.id',
    nonCurrent: "t.status IN ('Withdrawn','Rejected','Obsolete','Replaced','Superseded')",
    mustRef: /\bstatus\b/, label: 'CIP status (Withdrawn/Rejected/Obsolete/Replaced)',
  },
  {
    type: 'radar_item', from: 'radar_items t', join: 'e.source_id = CAST(t.id AS TEXT)',
    nonCurrent: "t.expires_at IS NOT NULL AND t.expires_at < :now",
    mustRef: /expires_at/, label: 'radar alert expiry',
  },
];

/** The body of the semantic_search render switch, bounded to that one tool. */
function semanticSwitchSource(): string {
  const src = fs.readFileSync(repoPath('mcp-server.ts'), 'utf8');
  const start = src.indexOf("server.tool('semantic_search'");
  if (start < 0) throw new Error('semantic_search tool not found in mcp-server.ts');
  const next = src.indexOf('server.tool(', start + 25);
  return src.slice(start, next > 0 ? next : undefined);
}

function caseBlock(sw: string, type: string): string | null {
  const m = sw.match(new RegExp(`case '${type}':([\\s\\S]*?)\\bbreak;`));
  return m ? m[1] : null;
}

function main(): void {
  const db = getDb();
  const now = new Date().toISOString();
  const sw = semanticSwitchSource();
  const problems: string[] = [];
  let asserted = 0;

  for (const s of SOURCES) {
    const sql =
      `SELECT COUNT(DISTINCT e.source_id) n FROM ${s.from}
         JOIN embedding_chunks e ON e.source_type = '${s.type}' AND ${s.join}
        WHERE ${s.nonCurrent.replace(':now', `'${now}'`)}`;
    let n = 0;
    try {
      n = (db.prepare(sql).get() as { n: number }).n;
    } catch (e) {
      problems.push(`${s.type}: validity probe failed (${(e as Error).message.slice(0, 60)})`);
      continue;
    }
    if (n === 0) continue; // nothing non-current in the index -> nothing to mislabel

    asserted++;
    const block = caseBlock(sw, s.type);
    if (block == null) {
      problems.push(`${s.type}: ${n} non-current row(s) embedded but semantic_search has no render case for it`);
    } else if (!s.mustRef.test(block)) {
      problems.push(
        `${s.type}: ${n} non-current row(s) (${s.label}) are embedded and served by semantic_search, `
        + `but its render case does not read the validity column - a superseded row reads as current`,
      );
    }
  }

  for (const p of problems) console.error(`  ${p}`);

  logRun('index-validity', {
    status: problems.length ? 'error' : 'success',
    items: asserted,
    error: problems.length ? problems.slice(0, 3).join(' | ').slice(0, 900) : undefined,
  }, db);

  console.log(
    problems.length
      ? `[check-index-validity] ${problems.length} status-bearing source(s) served flat by semantic_search`
      : `[check-index-validity] ${asserted} status-bearing source(s) with non-current embedded rows; each is annotated with its validity in semantic_search`,
  );
  if (problems.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) main();
