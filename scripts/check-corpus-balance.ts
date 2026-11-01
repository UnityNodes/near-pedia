/**
 * Is any embedding source flooding the index with content-free records?
 *
 * THE CLASS. A source can occupy a large share of the embedding index with
 * chunks that carry no prose - a name and a number, a title and nothing else -
 * and every other check stays green. check-index-coverage asks whether the rows
 * that SHOULD be embedded ARE embedded; it ratifies a dedup key by counting one
 * representative per key, so a collapse key that no-ops reads as perfect
 * coverage. check-corpus-text asks whether the text we hold matches upstream,
 * but only for bodies over 500 chars. Between them, nothing asks whether a whole
 * source_type is mostly noise.
 *
 * THE INSTANCE THAT NAMED IT. The docker registry writes the image SIZE
 * ("815.6 MB") into sdk_versions.description, unique per version, so the
 * (name, description) dedup that collapses npm prose never collapsed docker:
 * 537 of 595 sdk_version chunks (90%) were "your-org/yourchain-sdk\n\n1050.5 MB"
 * - ~30 chars, no prose. 396 of them FTS-matched "yourchain-sdk", diluting every SDK
 * retrieval, and the source_types:['sdk_version'] facet returned a wall of
 * sizes. check-index-coverage was GREEN throughout, keying on the same
 * non-collapsing representative. build-embeddings now excludes docker, but the
 * SHAPE recurs: any future source whose ingest stores a short structured field
 * as the embed text would flood the same way, invisibly.
 *
 * THE WALK. For every source_type with enough chunks to matter, the fraction of
 * its chunks that are content-free (under THIN_CHARS after trimming). A source
 * that is mostly thin is not a document source; it is metadata that a structured
 * tool should serve directly, and its presence in the vector index costs every
 * neighbour query. The floor is deliberately loose - real prose sources sit
 * under 7% here - so this fires only on a genuine flood, not on the handful of
 * legitimately terse rows (a release with a one-line note, a stub headline)
 * every source carries.
 */
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';

// A chunk under this many characters carries no retrievable prose - a name, a
// version, a size. Measured: post-fix the thinnest real source (sdk_version, npm
// only) is 6.9% thin; docker's flood was 90%. 60 sits well clear of both.
const THIN_CHARS = 60;
// Below this a source is too small for a fraction to mean anything.
const MIN_CHUNKS = 50;
// A source may carry a few terse rows; a MAJORITY of thin chunks is a flood.
const MAX_THIN_FRACTION = 0.40;

interface Row { source_type: string; chunks: number; thin: number }

function main(): void {
  const db = getDb();
  const rows = db.prepare(`
    SELECT source_type,
           COUNT(*) AS chunks,
           SUM(length(trim(chunk_text)) < ${THIN_CHARS}) AS thin
    FROM embedding_chunks
    GROUP BY source_type
    HAVING chunks >= ${MIN_CHUNKS}
    ORDER BY (CAST(thin AS REAL) / chunks) DESC
  `).all() as Row[];

  const problems: string[] = [];
  for (const r of rows) {
    const frac = r.thin / r.chunks;
    if (frac > MAX_THIN_FRACTION) {
      problems.push(
        `${r.source_type}: ${r.thin} of ${r.chunks} chunk(s) (${(frac * 100).toFixed(0)}%) are content-free ` +
        `(<${THIN_CHARS} chars) - a source flooding the index with near-empty records dilutes every retrieval it lands in`,
      );
    }
  }

  if (problems.length) {
    for (const p of problems) console.error(`  FLOOD  ${p}`);
    console.error(`[check-corpus-balance] ${problems.length} source(s) over ${(MAX_THIN_FRACTION * 100).toFixed(0)}% content-free chunks`);
  } else {
    const worst = rows[0];
    const worstPct = worst ? ((worst.thin / worst.chunks) * 100).toFixed(1) : '0';
    console.log(`[check-corpus-balance] ${rows.length} source type(s) walked; worst is ${worst?.source_type ?? '(none)'} at ${worstPct}% content-free, under the ${(MAX_THIN_FRACTION * 100).toFixed(0)}% floor`);
  }

  logRun('check-corpus-balance', {
    status: problems.length ? 'partial' : 'success',
    items: rows.length,
    error: problems.length ? problems.join(' ; ').slice(0, 1000) : undefined,
  }, db);

  if (problems.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error('check-corpus-balance failed:', err);
    logRun('check-corpus-balance', { status: 'error', error: String(err).slice(0, 500) });
    process.exit(1);
  }
}
