/**
 * Can the search actually find a document we know is there?
 *
 * WHY. Every other check here asks whether the data is present, related,
 * counted and rendered. None asks the question a user asks: I need this
 * document, will your search give it to me. A ranking change, a LIMIT, a
 * filter, a broken FTS trigger or an index that stopped being rebuilt all
 * leave every structural check green and make the product useless.
 *
 * Only SOURCES and FTS_INDEXES are app-specific, and both are built from this
 * app's own lib/search.ts: SOURCES picks 5 representative
 * tables `search` reads (this app's search covers 12 result-producing
 * blocks across FTS and LIKE), and FTS_INDEXES is exactly the 7 external-content FTS5
 * indexes `search` actually ranks through - confirmed by reading
 * lib/search.ts's unifiedSearch() block by block, not assumed. foundation_kb
 * has its own FTS index (check-fts-freshness's 9) but is not read by `search`
 * at all, so it is deliberately absent from both lists here.
 *
 * GROUND TRUTH WITHOUT SELF-REFERENCE. The trap this codebase keeps falling
 * into is comparing a number against itself, so the target is chosen by one
 * path and asserted through a completely different one. A phrase is picked
 * with plain SQL over a raw text column, verified to occur in exactly ONE row
 * across every table the search covers, and then asked of the tool.
 *
 * The targets are derived from the corpus rather than written down, so they
 * cannot go stale as content changes, and they are chosen deterministically
 * so two runs an hour apart compare like for like.
 *
 *   npx tsx scripts/check-retrieval.ts
 */

import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';

const BASE = process.env.MCP_URL ?? 'http://127.0.0.1:3131/mcp';

/** Text columns the cross-corpus search reads, and how to name a row. */
const SOURCES = [
  { table: 'cips', key: 'id', text: 'title' },
  { table: 'forum_topics', key: 'id', text: 'title' },
  { table: 'doc_pages', key: 'id', text: 'title' },
  { table: 'blog_posts', key: 'id', text: 'title' },
  { table: 'github_items', key: 'id', text: 'title' },
] as const;

/** How many targets to take from each source. Small: this costs MCP calls. */
const PER_SOURCE = 2;

/**
 * The other engine.
 *
 * `search` is FTS5 plus lib/rank.ts. `semantic_search` is embeddings plus RRF
 * over a different index. Two retrieval paths, one of them measured until now.
 *
 * The target is chosen the same way and against the index it will be asked
 * of: a phrase present in exactly ONE chunk.
 */
const SEMANTIC_TARGETS = 4;

/**
 * A ceiling, not a stopwatch — check-latency owns speed. This exists because
 * A type-filtered path once took 109 seconds while every check
 * stayed green: the call succeeded, just late.
 */
const SEMANTIC_BUDGET_MS = 25_000;

interface ChunkTarget { type: string; id: string; phrase: string }

/**
 * A rough sentence around `w`'s first occurrence in `text`, capped so a
 * fenced code block or a run-on paragraph cannot make the query absurd.
 * Falls back to the bare word if no sentence boundary is found nearby.
 */
function sentenceAround(text: string, w: string): string {
  const at = text.indexOf(w);
  if (at < 0) return w;
  const before = text.lastIndexOf('.', at);
  const afterDot = text.indexOf('.', at);
  const start = before >= 0 && at - before < 200 ? before + 1 : Math.max(0, at - 100);
  const end = afterDot >= 0 && afterDot - at < 200 ? afterDot + 1 : Math.min(text.length, at + w.length + 100);
  const s = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return s.length >= w.length + 5 ? s : w;
}

/**
 * Phrases that appear in exactly one embedding chunk.
 *
 * PICKS A SENTENCE, NOT A BARE WORD, to ask semantic_search with. The first
 * version asked with the bare unique word alone and went 0 of 4 on this
 * corpus - not because semantic_search was broken, but because the check
 * was asking a MEANING-based engine a question meaning cannot answer: a
 * single rare token carries almost no semantic content on its own
 * (confirmed by hand on all four original misses, including one - a plain
 * English verb in an ordinary sentence - that had no other explanation).
 * FTS uniqueness of the WORD still anchors which chunk is the one true
 * answer; the QUERY sent to semantic_search is now the sentence the word
 * actually appears in, which is the shape a real conceptual question takes.
 *
 * Candidates that look glued (an internal lowercase-to-uppercase jump, e.g.
 * "TeamsSeveral") or read as leaked markup/CSS (a hyphenated token immediately
 * preceded by '"' or '[', e.g. a class-selector fragment) are skipped: they are
 * corpus DEFECTS, not fair semantic-search questions, and check-corpus-text /
 * check-retrieval's own FTS-search half already have those covered elsewhere.
 *
 * Uniqueness is counted through the FTS index rather than `LIKE '%word%'`:
 * scanning every chunk body per candidate word is minutes, and this has to
 * run in a daily bucket.
 */
function pickChunkTargets(db: ReturnType<typeof getDb>): ChunkTarget[] {
  const out: ChunkTarget[] = [];
  const seen = new Set<string>();
  let rows: { source_type: string; source_id: string; chunk_text: string }[];
  try {
    rows = db.prepare(`
      SELECT source_type, source_id, chunk_text FROM embedding_chunks
      WHERE length(chunk_text) BETWEEN 200 AND 3000
      ORDER BY source_type, source_id, chunk_index LIMIT 3000
    `).all() as typeof rows;
  } catch { return out; }

  const countMatches = db.prepare(`SELECT COUNT(*) c FROM embedding_chunks_fts WHERE embedding_chunks_fts MATCH ?`);
  for (const r of rows) {
    if (out.length >= SEMANTIC_TARGETS) break;
    if (seen.has(r.source_type)) continue;
    for (const w of new Set(r.chunk_text.match(/[A-Za-z][A-Za-z0-9-]{9,}/g) ?? [])) {
      if (/[a-z][A-Z]/.test(w)) continue; // glued words, not a fair question
      const before = r.chunk_text.charAt(Math.max(0, r.chunk_text.indexOf(w) - 1));
      if (before === '"' || before === '[' || before === '*') continue; // leaked markup/CSS
      let n: number;
      try { n = (countMatches.get(`"${w}"`) as { c: number }).c; } catch { continue; }
      if (n !== 1) continue;
      out.push({ type: r.source_type, id: String(r.source_id), phrase: sentenceAround(r.chunk_text, w) });
      seen.add(r.source_type);
      break;
    }
  }
  return out;
}

interface Target { table: string; key: string; phrase: string; rowText: string }

/** Occurrences of a phrase across every searched column, not just its own. */
function corpusHits(db: ReturnType<typeof getDb>, phrase: string): number {
  let n = 0;
  for (const s of SOURCES) {
    try {
      n += (db.prepare(`SELECT COUNT(*) c FROM "${s.table}" WHERE "${s.text}" LIKE ?`)
        .get(`%${phrase}%`) as { c: number }).c;
    } catch { /* a table without that column contributes nothing */ }
    if (n > 1) return n;
  }
  return n;
}

/**
 * Does this term match exactly ONE document the way SEARCH matches?
 *
 * `corpusHits` above answers a narrower question: it LIKEs the phrase against
 * one text column per table - the right ground truth for "is this phrase a
 * unique IDENTIFIER of a row". It is the wrong ground truth for "should this
 * row rank first", because search reads BODIES too. So the rank assertion is
 * gated on uniqueness measured through the same indexes search matches
 * through.
 */
const FTS_INDEXES = [
  'cips_fts', 'forum_fts', 'docs_fts', 'cip_attachments_fts',
  'youtube_videos_fts', 'blog_posts_fts', 'whitepapers_fts',
];

function ftsUnique(db: ReturnType<typeof getDb>, phrase: string): boolean {
  // A phrase with FTS syntax in it cannot be asked this way; treat it as not
  // provably unique rather than guessing.
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(phrase)) return false;
  let n = 0;
  for (const f of FTS_INDEXES) {
    try { n += (db.prepare(`SELECT COUNT(*) c FROM ${f} WHERE ${f} MATCH ?`).get(phrase) as { c: number }).c; }
    catch { /* an index that cannot be matched contributes nothing */ }
    if (n > 1) return false;
  }
  return n === 1;
}

function pickTargets(db: ReturnType<typeof getDb>): Target[] {
  const out: Target[] = [];
  for (const s of SOURCES) {
    let taken = 0;
    let rows: { k: string; t: string }[] = [];
    try {
      rows = db.prepare(`
        SELECT "${s.key}" k, "${s.text}" t FROM "${s.table}"
        WHERE "${s.text}" IS NOT NULL AND length("${s.text}") BETWEEN 25 AND 120
        ORDER BY "${s.key}" LIMIT 300
      `).all() as { k: string; t: string }[];
    } catch { continue; }

    for (const r of rows) {
      if (taken >= PER_SOURCE) break;
      // Long words only: short ones are common and a fair search will rank
      // other things above them, which would make this check a coin toss.
      const words = [...new Set(r.t.match(/[A-Za-z][A-Za-z0-9-]{8,}/g) ?? [])];
      for (const w of words) {
        if (corpusHits(db, w) !== 1) continue;
        out.push({ table: s.table, key: String(r.k), phrase: w, rowText: r.t });
        taken++;
        break;
      }
    }
  }
  return out;
}

/** Thrown for a 429 so a throttled run is not reported as an outage. */
class RateLimited extends Error {}

async function callTool(name: string, args: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name, arguments: args },
      }),
      signal: AbortSignal.timeout(SEMANTIC_BUDGET_MS + 5_000),
    });
    // Held back is not the same fact as down. The limiter is shared by every
    // check on this box, so a throttled run is a normal thing to survive and
    // a misleading thing to report as an outage.
    if (res.status === 429) throw new RateLimited(`retry after ${res.headers.get('RateLimit-Reset') ?? '?'}s`);
    if (!res.ok) return null;
    for (const line of (await res.text()).split('\n')) {
      const l = line.startsWith('data: ') ? line.slice(6) : line;
      if (!l.trim().startsWith('{')) continue;
      const parsed = JSON.parse(l) as { result?: { content?: { text?: string }[]; isError?: boolean } };
      if (parsed.result?.isError) return null;
      return parsed.result?.content?.[0]?.text ?? null;
    }
    return null;
  } catch (err) {
    if (err instanceof RateLimited) throw err;
    return null;
  }
}

/** Collapse whitespace and drop the fence markers so a title matches as typed. */
function flatten(text: string): string {
  return text
    .replace(/=== (END )?UNTRUSTED INPUT[^=]*===/g, ' ')
    .split(/\s+/).join(' ')
    .toLowerCase();
}

async function main(): Promise<void> {
  const db = getDb();
  const targets = pickTargets(db);

  if (targets.length === 0) {
    console.error('[check-retrieval] UNVERIFIED: no uniquely identifiable row found to search for');
    logRun('check-retrieval', { status: 'partial', items: 0, error: 'no target could be derived' }, db);
    process.exitCode = 1;
    return;
  }

  const misses: string[] = [];
  const unverified: string[] = [];
  let hits = 0;
  let throttled = '';

  for (const t of targets) {
    let answer: string | null;
    try {
      answer = await callTool('search', { query: t.phrase });
    } catch (err) {
      throttled = `rate-limited at "${t.phrase}" (${(err as Error).message})`;
      break;
    }
    if (answer === null) { unverified.push(`${t.table}/${t.key}: search did not answer`); continue; }

    // The row's own text, never the query: the header repeats the query back.
    const want = flatten(t.rowText).slice(0, 60);
    if (flatten(answer).includes(want)) {
      hits++;
      // WHERE it came back, not just that it did. corpusHits has already
      // proved this phrase occurs in exactly ONE row of the whole index, so
      // there is no honest competitor: the document holding it belongs first.
      const blocks = answer.split(/\n(?=[ \t]*\d+\. )/).slice(1);
      const at = blocks.findIndex((b) => flatten(b).includes(want));
      if (ftsUnique(db, t.phrase) && blocks.length > 1 && at > 0) {
        misses.push(
          `"${t.phrase}" matches exactly one document in the FTS index (${t.table}/${t.key}) and search ranked it ${at + 1} of ${blocks.length}`,
        );
      } else {
        console.log(`  ok      "${t.phrase}" → ${t.table}/${t.key}${at === 0 ? ' (rank 1)' : ` (rank ${at + 1}, term not FTS-unique)`}`);
      }
    } else {
      misses.push(`"${t.phrase}" is in exactly one row of the whole corpus (${t.table}/${t.key}) and search did not return it`);
    }
  }

  // ── the other engine ──────────────────────────────────────────────────────
  const chunkTargets = throttled ? [] : pickChunkTargets(db);
  let semHits = 0;
  let semSlow = 0;
  if (!throttled && chunkTargets.length === 0) {
    unverified.push('semantic_search: no phrase unique to a single chunk could be derived');
  }
  for (const t of chunkTargets) {
    const t0 = Date.now();
    let answer: string | null;
    try {
      answer = await callTool('semantic_search', { query: t.phrase });
    } catch (err) {
      throttled = `rate-limited at semantic_search "${t.phrase}" (${(err as Error).message})`;
      break;
    }
    const ms = Date.now() - t0;
    if (answer === null) { unverified.push(`semantic_search/${t.type}: did not answer`); continue; }
    // The phrase is in exactly one chunk, so the chunk's own id is the answer.
    if (answer.includes(t.id)) {
      semHits++;
      console.log(`  ok      "${t.phrase}" → ${t.type}/${t.id} via semantic_search (${ms}ms)`);
    } else {
      misses.push(`"${t.phrase}" is in exactly one embedding chunk (${t.type}/${t.id}) and semantic_search did not return it`);
    }
    if (ms > SEMANTIC_BUDGET_MS) {
      semSlow++;
      misses.push(`semantic_search took ${ms}ms for "${t.phrase}", over the ${SEMANTIC_BUDGET_MS}ms ceiling`);
    }
  }

  // The filtered path, separately. It is a different query plan.
  if (!throttled && chunkTargets.length) {
    const t0 = Date.now();
    let filtered: string | null = null;
    try { filtered = await callTool('semantic_search', { query: chunkTargets[0].phrase, source_types: [chunkTargets[0].type] }); }
    catch (err) { throttled = `rate-limited on the filtered semantic_search (${(err as Error).message})`; }
    const ms = Date.now() - t0;
    if (!throttled) {
      // Answering is not the assertion. The phrase is unique to one chunk and
      // the filter names that chunk's own type, so the filtered call must
      // return the SAME chunk — a filter that narrows to nothing also
      // answers, quickly, and used to read as a pass.
      if (filtered === null) unverified.push('semantic_search with source_types: did not answer');
      else if (!filtered.includes(chunkTargets[0].id)) {
        misses.push(`semantic_search with source_types=[${chunkTargets[0].type}] did not return ${chunkTargets[0].id}, which is the only chunk holding "${chunkTargets[0].phrase}"`);
      } else if (ms > SEMANTIC_BUDGET_MS) {
        misses.push(`semantic_search with source_types took ${ms}ms, over the ${SEMANTIC_BUDGET_MS}ms ceiling`);
      } else console.log(`  ok      source_types=[${chunkTargets[0].type}] returned ${chunkTargets[0].id} in ${ms}ms`);
    }
  }

  // Counted per engine. Folding the semantic misses into the FTS line printed
  // a sentence that was not about anything.
  const ftsMisses = misses.filter((m) => !m.startsWith('"') || !m.includes('embedding chunk')).length - misses.filter((m) => m.startsWith('semantic_search')).length;
  console.log(
    `[check-retrieval] ${targets.length} unique phrase(s) asked of search: ` +
    `${hits} returned their row, ${Math.max(0, ftsMisses)} did not, ${unverified.length} unverified` +
    (throttled ? ', stopped early on the rate limiter' : ''),
  );
  console.log(
    `                  ${semHits} of ${chunkTargets.length} chunk-unique phrase(s) returned their chunk through semantic_search` +
    (semSlow ? `, ${semSlow} over the ${SEMANTIC_BUDGET_MS}ms ceiling` : ''),
  );
  for (const m of misses) console.error(`  MISS        ${m}`);
  for (const u of unverified) console.error(`  UNVERIFIED  ${u}`);
  if (throttled) {
    console.error(`  THROTTLED   ${throttled}`);
    console.error('              not an outage and not a pass: the phrases after this one went unasked');
  }

  const failures = misses.length + unverified.length;
  logRun('check-retrieval', {
    status: failures || throttled ? 'partial' : 'success',
    // Targets searched for, not targets found.
    items: targets.length + chunkTargets.length,
    error: [...misses, ...unverified, ...(throttled ? [throttled] : [])].join(' ; ').slice(0, 1000) || undefined,
  }, db);

  if (failures || throttled) process.exitCode = 1;
}

main();
