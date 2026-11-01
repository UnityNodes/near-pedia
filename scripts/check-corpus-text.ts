/**
 * Is the text we hold the text that arrived, and can anything find it?
 *
 * TOKENIZABLE + WHOLE questions only. A third question - whether a doc_pages
 * row still carries the publisher's own site chrome (nav widgets, feedback
 * footers) - is deliberately not asked here: answering it needs a chrome
 * stripper built by studying the actual docs-site markup of
 * docs.yourchain.example, which is real, separate investigation. A chrome
 * detector written blind would either match nothing (false confidence) or
 * flag prose it doesn't understand. Left for a follow-up that reads real
 * docs.yourchain.example pages first.
 *
 * WHY THE OTHER TWO STILL MATTER. The existing checks cannot see either
 * defect, and it is worth being precise about why:
 *
 *   check-completeness   asks upstream HOW MANY there are. A truncated
 *                        document is still one document.
 *   check-fts-freshness  compares the INDEX to the table. Both would agree,
 *                        on text that was already wrong.
 *   check-refusals       asks whether we hold what policy says we must not.
 *                        None of our refusal rules are about a row's own
 *                        text being damaged.
 *
 * WHAT THIS ASKS INSTEAD. Two questions about the bytes themselves, answered
 * from the database with no network call and no MCP request:
 *
 *   1. TOKENIZABLE   does the stored text have word boundaries? A document
 *                    without them is held, indexed, embedded and unfindable.
 *   2. WHOLE         did a length cap bite? Caps are legitimate; a cap that
 *                    leaves no trace is not. lib/cap-text.ts marks them when
 *                    a sync uses it, and this also looks for the tell-tale
 *                    of an UNMARKED one: many rows at one exact length.
 *
 * Question 2's second half is the interesting one. An unmarked cap cannot be
 * detected in a single row - a body may simply end at 20 000 characters -
 * but it can be detected in a POPULATION: real documents do not share an
 * exact length. Five or more rows in one column at one exact length, well
 * clear of its neighbours, is a cap.
 *
 * Cadence: daily via deploy/sync-tick.sh. Log: sync_log source='corpus-text'.
 * Reads the database only.
 */

import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { gluedRuns, looksGlued } from '../lib/pdf-text';
import { TRUNCATION_MARKER } from '../lib/cap-text';

interface Problem {
  question: 'tokenizable' | 'whole';
  where: string;
  what: string;
}

/** Text columns an agent can be served, and how to name a row of each. */
const SURFACES: { table: string; id: string; column: string; label: string }[] = [
  { table: 'whitepapers', id: 'slug', column: 'content_text', label: 'slug' },
  { table: 'cip_attachments', id: 'filename', column: 'content_text', label: 'filename' },
  { table: 'cips', id: 'id', column: 'content_md', label: 'id' },
  { table: 'doc_pages', id: 'url', column: 'content_text', label: 'url' },
  { table: 'blog_posts', id: 'id', column: 'content_text', label: 'id' },
  { table: 'forum_posts', id: 'id', column: 'cooked', label: 'id' },
  { table: 'youtube_videos', id: 'id', column: 'transcript_text', label: 'id' },
  { table: 'github_items', id: 'id', column: 'body', label: 'id' },
  { table: 'foundation_kb', id: 'id', column: 'content', label: 'id' },
];

/** Rows sharing one exact length before it is read as a cap rather than chance. */
const CAP_COHORT = 5;

/**
 * Lengths that are a cap by construction, not by coincidence.
 *
 * Only round numbers qualify. Without this, 5 empty-ish rows at length 0 or
 * a cohort of identical boilerplate would each read as a cap.
 */
function looksLikeCap(len: number): boolean {
  return len >= 1000 && (len % 1000 === 0 || len % 1024 === 0);
}

function main(): void {
  const db = getDb();
  const problems: Problem[] = [];
  const notes: string[] = [];
  let examined = 0;

  for (const s of SURFACES) {
    let rows: { id: string; t: string }[];
    try {
      rows = db.prepare(
        `SELECT ${s.id} AS id, ${s.column} AS t FROM ${s.table}
          WHERE ${s.column} IS NOT NULL AND length(${s.column}) > 500`,
      ).all() as { id: string; t: string }[];
    } catch (err) {
      // A surface that cannot be read is not a surface that passed.
      problems.push({
        question: 'tokenizable',
        where: `${s.table}.${s.column}`,
        what: `could not be read: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    examined += rows.length;

    // 1. TOKENIZABLE
    for (const r of rows) {
      if (!looksGlued(r.t)) continue;
      problems.push({
        question: 'tokenizable',
        where: `${s.table}.${s.label}=${String(r.id).slice(0, 70)}`,
        what: `${gluedRuns(r.t)} runs of 25+ letters and almost no spaces in ${r.t.length} chars; `
          + 'the words have no boundaries, so FTS cannot index them and search cannot find this document',
      });
    }

    // 2. WHOLE — the marked half.
    const marked = rows.filter((r) => r.t.includes(TRUNCATION_MARKER));
    if (marked.length) {
      notes.push(
        `${s.table}.${s.column}: ${marked.length} row(s) hit the storage cap and say so `
        + `(e.g. ${s.label}=${String(marked[0].id).slice(0, 60)})`,
      );
    }

    // 2. WHOLE — the unmarked half, found by population rather than by row.
    const byLength = new Map<number, string[]>();
    for (const r of rows) {
      if (r.t.includes(TRUNCATION_MARKER)) continue;
      const list = byLength.get(r.t.length) ?? [];
      list.push(String(r.id));
      byLength.set(r.t.length, list);
    }
    for (const [len, ids] of byLength) {
      if (ids.length < CAP_COHORT || !looksLikeCap(len)) continue;
      // A cap is a SPIKE, not merely a cohort: compare against the busiest
      // length within 50 characters.
      let neighbour = 0;
      for (const [other, list] of byLength) {
        if (other === len || Math.abs(other - len) > 50) continue;
        if (list.length > neighbour) neighbour = list.length;
      }
      if (ids.length < neighbour * 3) continue;
      problems.push({
        question: 'whole',
        where: `${s.table}.${s.column}`,
        what: `${ids.length} rows are EXACTLY ${len} chars long (e.g. ${ids.slice(0, 3).join(', ')}). `
          + 'Documents do not agree on a length by chance: this is an unmarked cap, and every one of those rows is cut',
      });
    }
  }

  for (const n of notes) console.log(`  [note] ${n}`);
  for (const p of problems) console.error(`  [${p.question}] ${p.where}\n      ${p.what}`);

  const status = problems.length ? 'error' : 'success';
  logRun('corpus-text', {
    status,
    items: examined,
    error: problems.length
      ? `${problems.length} corpus-text problem(s) across ${SURFACES.length} surfaces: `
        + problems.slice(0, 3).map((p) => `${p.where} ${p.what.slice(0, 90)}`).join(' | ')
      : undefined,
  });

  console.log(
    problems.length
      ? `[check-corpus-text] ${problems.length} problem(s) over ${examined} documents in ${SURFACES.length} surfaces`
      : `[check-corpus-text] ${examined} documents in ${SURFACES.length} surfaces are whole and tokenizable`,
  );
  if (problems.length) process.exitCode = 1;
}

main();
