/**
 * Is anything in the corpus written to steer a model rather than inform a
 * reader — and is it on the fenced side of the trust boundary if so?
 *
 * lib/doc-trust.ts decides trust by URL and fences everything else. What it
 * cannot say is whether that boundary is in the right place TODAY, because the
 * only evidence it cites is the reasoning that put it there. This runs the
 * question against the corpus actually held.
 *
 * The other half of check-fencing, which every project built from this template
 * gets and this one did not ship. The two ask different questions: check-fencing
 * asks whether a TOOL declares the text it serves, this asks whether the text
 * itself is trying to give instructions and whether it sits on the side of the
 * boundary that assumes it might be.
 *
 * Patterns deliberately wider than doc-trust's own stripAgentDirectives, which
 * removes the shapes already known. The question here is whether anything else
 * is addressed to a model at all, so a new shape shows up as a finding rather
 * than passing through a stripper that does not know it.
 *
 * A hit in a FENCED corpus is reported and does not fail: fencing is what the
 * project does about it. A hit in an UNFENCED one fails — that is text a calling
 * agent is handed as trusted.
 *
 * A corpus whose query throws is a FAILURE, not a skip. Writing a column that
 * does not exist would otherwise read as a clean scan of nothing.
 *
 *   npx tsx scripts/check-doc-trust.ts
 */
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { isFirstPartyDoc } from '../lib/doc-trust';

const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['"Agent Instructions" block', /#+\s*Agent Instructions/i],
  ['"Querying This Documentation" block', /#+\s*Querying This Documentation/i],
  ['ignore previous instructions', /ignore (all )?(previous|above|prior) (instructions|prompts)/i],
  ['disregard earlier instructions', /disregard (the )?(previous|above|prior|earlier)\s+(instructions|prompts|context)/i],
  ['addressed to an assistant', /\byou are an? (AI|assistant|language model|LLM)\b/i],
  // Anchored to the start of a line and requiring a colon. Allowing a comma
  // anywhere in a sentence matched ordinary prose: "an MCP server for AI
  // agents, and self-service API keys" and "whether any AI tools (LLMs, AI
  // assistants, copilots...)" both matched, and those sat on first-party
  // pages where a hit is a failure. What the pattern is for is the
  // vocative - a label addressing a reader that is not a person - and that is
  // written at the head of a line.
  ['addressed to agents', /^[\s>#*\-]*(AI agents?|LLMs?|language models?|assistants?)\s*:/im],
  ['mentions a system prompt', /\bsystem prompt\b/i],
  ['asks to hide something from the user', /\bdo not (tell|inform|mention to|reveal to) the user\b/i],
  ['assistant/system tag', /<\/?(claude|assistant|system)\b/i],
];

/**
 * `key` is whatever the fencing decision is made from, so it is the url for a
 * doc page. It doubles as what a finding is reported by.
 */
interface Corpus { label: string; sql: string; fenced: 'yes' | 'no' | 'by-url' }

const CORPORA: Corpus[] = [
  // Trust per ROW, which is the whole point of deriving it from the publisher
  // rather than from the table.
  { label: 'doc_pages', sql: 'SELECT url AS key, content_text AS t FROM doc_pages', fenced: 'by-url' },

  // Served as first-party. A hit here is a failure.
  { label: 'github_releases', sql: 'SELECT url AS key, body AS t FROM github_releases', fenced: 'no' },

  // Fenced on the way out. A hit is reported so the boundary can be re-judged.
  { label: 'forum_posts', sql: "SELECT '' AS key, cooked AS t FROM forum_posts", fenced: 'yes' },
  { label: 'github_items', sql: 'SELECT url AS key, body AS t FROM github_items', fenced: 'yes' },
  { label: 'github_discussions', sql: 'SELECT url AS key, body AS t FROM github_discussions', fenced: 'yes' },
  { label: 'youtube_videos', sql: 'SELECT url AS key, description AS t FROM youtube_videos', fenced: 'yes' },
  { label: 'blog_posts', sql: 'SELECT url AS key, content_text AS t FROM blog_posts', fenced: 'yes' },
  { label: 'radar_items', sql: 'SELECT source_url AS key, body AS t FROM radar_items', fenced: 'yes' },
];

/**
 * A fork adds tables. youtube transcripts, a mailing list, ecosystem
 * self-listings and featured apps all exist in projects built from this
 * template and none of them is here, because none of them is in this schema.
 * Adding a corpus is one line; leaving a third-party table out of this list is
 * how it goes unexamined, and a clean run over eleven corpora says nothing
 * about a twelfth.
 */

const db = getDb();
const failures: string[] = [];
let scanned = 0;

for (const c of CORPORA) {
  let rows: { key: string | null; t: string | null }[];
  try { rows = db.prepare(c.sql).all() as { key: string | null; t: string | null }[]; }
  catch (err) { failures.push(`${c.label}: ${(err as Error).message}`); continue; }

  const unfencedHits: string[] = [];
  const fencedHits: string[] = [];
  for (const r of rows) {
    if (!r.t) continue;
    scanned++;
    for (const [name, re] of PATTERNS) {
      if (!re.test(r.t)) continue;
      const isFenced =
        c.fenced === 'yes' ? true
        : c.fenced === 'by-url' ? !isFirstPartyDoc(r.key)
        : false;
      (isFenced ? fencedHits : unfencedHits).push(`${name} in ${r.key || '(no key)'}`);
    }
  }
  const note = [
    fencedHits.length ? `${fencedHits.length} fenced` : '',
    unfencedHits.length ? `${unfencedHits.length} UNFENCED` : '',
  ].filter(Boolean).join(', ') || 'clean';
  console.log(`  ${c.label.padEnd(20)} ${String(rows.length).padStart(6)} rows — ${note}`);
  for (const h of fencedHits.slice(0, 3)) console.log(`      (fenced, reported only) ${h}`);
  for (const h of unfencedHits) failures.push(`${c.label}: ${h}`);
}

console.log(`\n[check-doc-trust] ${scanned} text row(s) scanned across ${CORPORA.length} corpora, ${failures.length} served unfenced`);
for (const f of failures) console.error(`  ${f}`);

logRun('check-doc-trust', {
  status: failures.length ? 'partial' : 'success',
  items: scanned,
  error: failures.length ? failures.join(' ; ').slice(0, 1000) : undefined,
}, db);

process.exit(failures.length ? 1 : 0);
