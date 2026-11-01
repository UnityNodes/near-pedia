/**
 * Is every corpus row the embedding index is supposed to hold actually in it?
 *
 * WHY NOTHING ELSE ASKS THIS. check-index-freshness compares stored chunks
 * against the text they were built from — but only for documents that HAVE
 * chunks. Its own line 87 skips a zero-chunk document by name: "not embedded
 * yet; not this check's question". check-completeness asks whether we hold what
 * upstream has. check-sources asks whether we publish what we hold. Between
 * "held" and "embedded" there is no check at all, and semantic_search can only
 * find what is embedded.
 *
 * So a sync could keep working, a table could keep growing, every published
 * count could keep rising, and the half of the product that answers conceptual
 * questions could quietly stop seeing a whole source. Every one of the 30
 * scheduled checks would stay green.
 *
 * THREE OUTCOMES PER ROW, and the middle one is the point:
 *
 *   embedded    chunks exist for it
 *   excluded    build-embeddings' own length or emptiness rule leaves it out,
 *               and lib/index-coverage.ts says which rule and why
 *   LAGGING     synced after the last embedding run, so it has not had its turn
 *   MISSING     none of the above — the gap this file exists to find
 *
 * And one gate that is about the QUESTION rather than a row: the key a source is
 * indexed by has to be unique over its own table. `embedded` is a set of ids and
 * each row is tested for membership in it, so two rows sharing a key both pass
 * on one chunk. The line printed ids on the left and rows on the right and said
 * `538 embedded of 540 expected` followed by `ok`, for as long as this check had
 * existed.
 *
 * TWO SOURCES. The row count comes from the source table; the embedded set comes
 * from embedding_chunks. Neither is derived from the other, and neither is
 * derived from the loader — lib/index-coverage.ts restates the loader's filter
 * as SQL rather than importing loadAllDocs, so a loader rule that changes without
 * this file changing shows up as a disagreement instead of as agreement.
 *
 * WHAT IT CANNOT SEE. Whether the embedded text is RIGHT — that is
 * check-index-freshness. Whether a row should have been accepted at all — that
 * is check-refusals. Whether the vector for a chunk exists — check-vec, which is
 * a diagnostic and not scheduled.
 *
 *   npx tsx scripts/check-index-coverage.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../lib/db';
import { buildSourceLink } from '../lib/source-urls';
import { logRun } from '../lib/sync-log';
import { INDEXED_SOURCES, EMBED_LAG_GRACE_HOURS, type IndexedSource } from '../lib/index-coverage';
import { isEntrypoint } from '../lib/is-entrypoint';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const VERBOSE = process.argv.includes('--verbose');
const SAMPLE = 5;

interface Problem { source: string; what: string; rows: string[] }

/** When build-embeddings last finished, from its own log rather than a guess. */
function lastEmbedRun(db: ReturnType<typeof getDb>): string | null {
  const row = db.prepare(
    `SELECT MAX(ran_at) t FROM sync_log WHERE source LIKE '%embed%' AND status IN ('success','partial')`,
  ).get() as { t: string | null };
  return row.t;
}

function walk(db: ReturnType<typeof getDb>, s: IndexedSource, cutoff: string | null) {
  const embedded = new Set(
    (db.prepare('SELECT DISTINCT source_id FROM embedding_chunks WHERE source_type = ?').all(s.type) as { source_id: unknown }[])
      .map((r) => String(r.source_id)),
  );

  const cols = `${s.keyExpr} AS k` + (s.syncedAt ? `, "${s.syncedAt}" AS t` : ', NULL AS t');
  const expected = db.prepare(`SELECT ${cols} FROM "${s.table}" WHERE ${s.where}`).all() as { k: unknown; t: string | null }[];
  const total = (db.prepare(`SELECT COUNT(*) c FROM "${s.table}"`).get() as { c: number }).c;

  const missing: { k: string; t: string | null }[] = [];
  let lagging = 0;
  for (const r of expected) {
    if (embedded.has(String(r.k))) continue;
    // A row synced after the last embedding run has not had its turn. Without a
    // cutoff every run of this check would be red for whatever the syncs added
    // in the last six hours, which is a check nobody would read.
    if (cutoff && r.t && String(r.t) > cutoff) { lagging++; continue; }
    missing.push({ k: String(r.k), t: r.t });
  }

  // Is the key this source is indexed BY unique over its own table?
  //
  // Without this the coverage number above is not a coverage number. `embedded`
  // is a SET of distinct source_ids, and every expected row is tested for
  // membership in it, so two rows sharing a key both pass on the strength of
  // one chunk. The printed line counts ids on the left and ROWS on the right,
  // which is how this source read `538 embedded of 540 expected` and still said
  // ok for as long as it has existed.
  //
  // ecosystem_projects is the case: the table declares UNIQUE(source, slug) and
  // means it - two catalogs can list the same project - while the index
  // keyed on the bare slug. Two projects had no chunks at all and semantic
  // search could not reach them.
  //
  // Sixteen of the seventeen sources key on their table's own `id`, so this is
  // a tripwire on the seventeenth and on whatever is added next.
  // Rows the declared rule EXCLUDES that have chunks anyway.
  //
  // The other direction, and it was never asked. Everything above walks
  // expected -> embedded and reports a row with no chunks; nothing walked
  // embedded -> expected, so a row the rule excludes could be indexed and the
  // only trace was the two numbers on the printed line disagreeing. blog_post
  // read "1030 embedded of 1008 expected" and said ok for as long as this check
  // has existed: the loader took `content_text IS NOT NULL`, the rule here said
  // `<> ''`, and 22 empty-bodied posts were embedded as their own headline.
  //
  // This is not a data fault. It means the restatement and the loader have
  // drifted, which is the one thing this file's two-source design exists to
  // notice, and it was noticing it into a number nobody compared.
  let surplus: string[] = [];
  try {
    surplus = (db.prepare(
      `SELECT ${s.keyExpr} AS k FROM "${s.table}" WHERE NOT (${s.where})`,
    ).all() as { k: unknown }[])
      .map((r) => String(r.k))
      .filter((k) => embedded.has(k));
  } catch { /* an unusable where is reported by the walk above */ }

  let dupKeys = 0;
  try {
    dupKeys = (db.prepare(
      `SELECT COUNT(*) c FROM (SELECT 1 FROM "${s.table}" WHERE ${s.where} GROUP BY ${s.keyExpr} HAVING COUNT(*) > 1)`,
    ).get() as { c: number }).c;
  } catch { /* a keyExpr this cannot group by is reported by the walk above */ }

  return { total, expected: expected.length, excluded: total - expected.length, embedded: embedded.size, lagging, missing, dupKeys, surplus };
}

function main(): void {
  const db = getDb();
  const last = lastEmbedRun(db);
  const cutoff = last
    ? new Date(Date.parse(last) - EMBED_LAG_GRACE_HOURS * 3_600_000).toISOString()
    : null;

  const problems: Problem[] = [];
  const lines: string[] = [];
  let rowsWalked = 0;
  let sourcesWalked = 0;
  let unreadable = 0;

  for (const s of INDEXED_SOURCES) {
    let r: ReturnType<typeof walk>;
    try {
      r = walk(db, s, cutoff);
    } catch (err) {
      // Never silent: a source this cannot read is a source it is not covering,
      // and saying so is the difference between a gap and an opinion.
      unreadable++;
      problems.push({ source: s.type, what: `could not be walked: ${(err as Error).message.slice(0, 90)}`, rows: [] });
      continue;
    }
    sourcesWalked++;
    rowsWalked += r.expected;

    lines.push(
      `  ${r.missing.length || r.dupKeys || r.surplus.length ? 'GAP  ' : 'ok   '} ${s.type.padEnd(20)} ` +
      `${String(r.embedded).padStart(6)} embedded of ${String(r.expected).padStart(6)} expected` +
      `${r.excluded ? `, ${r.excluded} excluded` : ''}${r.lagging ? `, ${r.lagging} lagging` : ''}`,
    );

    if (r.surplus.length) {
      problems.push({
        source: s.type,
        what: `${r.surplus.length} row(s) the declared rule EXCLUDES have chunks anyway, so lib/index-coverage.ts and scripts/build-embeddings.ts disagree about what counts as content`,
        rows: r.surplus.slice(0, SAMPLE),
      });
    }

    if (r.dupKeys) {
      problems.push({
        source: s.type,
        what: `indexed by ${s.keyExpr}, which is NOT unique over ${s.table}: ${r.dupKeys} key(s) are shared by more than one row, so those rows cannot each have their own chunks and the coverage number above cannot see it`,
        rows: [],
      });
    }

    if (r.missing.length) {
      problems.push({
        source: s.type,
        what: `${r.missing.length} row(s) the loader should have embedded have no chunks at all`,
        rows: r.missing.slice(0, VERBOSE ? r.missing.length : SAMPLE).map((m) => `${m.k}${m.t ? ` (synced ${String(m.t).slice(0, 19)})` : ''}`),
      });
    }
  }

  // ── can the serving layer turn a chunk id back into its row? ─────────────
  //
  // A THIRD direction on the same seam. The two above ask whether the row has
  // chunks and whether the chunk has a row. This asks whether the code that
  // renders a citation can actually perform the join, and it is the one that
  // was broken: mcp-server.ts resolved `ecosystem_project` hits with
  // `WHERE id = ?` against an INTEGER PRIMARY KEY while the loader had written
  // the slug. It matched nothing for all 540 projects, forever. Nothing threw -
  // `title` and `url` start as empty strings - so semantic_search served every
  // ecosystem hit with the raw `source_type:source_id` as its heading and no
  // link, and every other check stayed green because the chunk existed, the row
  // existed, and the text was right.
  //
  // Two halves, because the resolvers live in two files:
  //
  //   lib/source-urls.ts   is CALLED with a real chunk id per source type and
  //                        must return a link. Behavioural: no parsing, and it
  //                        exercises the code the citations actually use.
  //   mcp-server.ts        has its own switch, so each `case` is read out of the
  //                        source. A case doing its own `WHERE col = ?` has that
  //                        column tested against real ids; a case delegating to
  //                        a shared helper is covered by the half above.
  const chunkTypes = db.prepare(
    'SELECT source_type, COUNT(DISTINCT source_id) n FROM embedding_chunks GROUP BY source_type',
  ).all() as { source_type: string; n: number }[];
  let resolverChecked = 0;
  for (const { source_type } of chunkTypes) {
    const sample = db.prepare(
      'SELECT source_id FROM embedding_chunks WHERE source_type = ? LIMIT 25',
    ).all(source_type) as { source_id: unknown }[];
    if (!sample.length) continue;
    resolverChecked++;
    const unresolved = sample.filter((r) => {
      try { return !buildSourceLink(source_type, String(r.source_id))?.url; }
      catch { return true; }
    });
    if (unresolved.length === sample.length) {
      problems.push({
        source: source_type,
        what: `lib/source-urls.ts cannot resolve ANY of ${sample.length} sampled chunk id(s) to a link, so every citation of this source is served without one`,
        rows: sample.slice(0, SAMPLE).map((r) => String(r.source_id)),
      });
    } else if (unresolved.length) {
      problems.push({
        source: source_type,
        what: `lib/source-urls.ts cannot resolve ${unresolved.length} of ${sample.length} sampled chunk id(s) to a link`,
        rows: unresolved.slice(0, SAMPLE).map((r) => String(r.source_id)),
      });
    }
  }

  // The MCP server's own switch, read out of its source.
  const mcpSrc = fs.readFileSync(path.join(ROOT, 'mcp-server.ts'), 'utf8');
  // Segment on `case 'x':` and take the first db.prepare inside each segment.
  //
  // NOT `case 'x': {\s*const r = db.prepare(...)`, which is what this was, and
  // which the control caught: that pattern needs the lookup to be the first
  // thing after the brace, so ANY case carrying an explanatory comment - and in
  // this repo that is most of them eventually - silently drops out of the
  // surface. A gate that stops covering a case the moment somebody documents it
  // is a gate that quietly shrinks.
  const segs = mcpSrc.split(/case '(?=[a-z_]+':)/);
  let mcpChecked = 0;
  for (const seg of segs.slice(1)) {
    const type = seg.slice(0, seg.indexOf("'"));
    if (!/^[a-z_]+$/.test(type)) continue;
    // Stop at the next case so a segment cannot borrow its neighbour's query.
    const body = seg.split(/\bcase '/)[0];
    const pm = body.match(/db\.prepare\(\s*'([^']*\bFROM\b[^']*)'\s*\)/i);
    if (!pm) continue;
    const sql = pm[1];
    const tbl = sql.match(/FROM\s+([a-z_]+)/i)?.[1];
    const col = sql.match(/WHERE\s+([a-z_]+)\s*=/i)?.[1];
    if (!tbl || !col) continue;
    const ids = db.prepare(
      'SELECT source_id FROM embedding_chunks WHERE source_type = ? LIMIT 25',
    ).all(type) as { source_id: unknown }[];
    if (!ids.length) continue;
    mcpChecked++;
    let hit = 0;
    try {
      const stmt = db.prepare(`SELECT 1 FROM "${tbl}" WHERE "${col}" = ? LIMIT 1`);
      for (const i of ids) if (stmt.get(String(i.source_id))) hit++;
    } catch { hit = -1; }
    if (hit <= 0) {
      problems.push({
        source: type,
        what: `mcp-server.ts resolves this citation with ${tbl}.${col}, which matches none of ${ids.length} real chunk id(s): semantic_search serves these hits with no title and no URL`,
        rows: ids.slice(0, SAMPLE).map((i) => String(i.source_id)),
      });
    }
  }
  lines.push(`  ok    resolvers            ${String(resolverChecked).padStart(6)} source type(s) via lib/source-urls.ts, ${mcpChecked} via mcp-server.ts's own switch`);

  // A chunk whose row is gone is the other direction of the same seam.
  const orphanTypes = db.prepare(
    `SELECT source_type, COUNT(DISTINCT source_id) n FROM embedding_chunks GROUP BY source_type`,
  ).all() as { source_type: string; n: number }[];
  const known = new Set(INDEXED_SOURCES.map((s) => s.type));
  const undeclared = orphanTypes.filter((t) => !known.has(t.source_type));
  for (const u of undeclared) {
    problems.push({
      source: u.source_type,
      what: `${u.n} document(s) are embedded under a source type lib/index-coverage.ts does not declare, so nothing checks whether they are complete`,
      rows: [],
    });
  }

  console.log(
    `[check-index-coverage] ${sourcesWalked} of ${INDEXED_SOURCES.length} source(s), ${rowsWalked} row(s) expected in the index` +
    (last ? `; last embedding run ${last.slice(0, 19)}` : '; no embedding run recorded, so nothing was treated as lag'),
  );
  for (const l of lines) console.log(l);

  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems) {
      console.error(`  [${p.source}] ${p.what}`);
      for (const r of p.rows) console.error(`      ${r}`);
      if (!VERBOSE && p.rows.length === SAMPLE) console.error('      (--verbose for the rest)');
    }
  } else {
    console.log('\nevery row the loader is expected to embed has chunks, or is excluded by a declared rule');
  }

  logRun('check-index-coverage', {
    status: problems.length ? 'partial' : 'success',
    items: rowsWalked,
    error: problems.length ? problems.map((p) => `${p.source}: ${p.what}`).join(' ; ').slice(0, 1000) : undefined,
  }, db);

  if (problems.length || unreadable) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) main();
