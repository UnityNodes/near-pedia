/**
 * Relevance ranking for unified search.
 *
 * nearpedia keeps its existing per-source blocks and applies this as a
 * REORDERING pass over the assembled results, which buys real idf-weighted
 * relevance without rewriting all 13 retrieval sites.
 *
 * Requires the fts5vocab tables: `npx tsx scripts/migrate-vocab.ts`.
 * Without them idf degrades to uniform (and warns once) - results are still
 * returned, just ordered less well.
 */
// Structural, and deliberately loose on the argument side: better-sqlite3's
// Statement generics are not assignable to a strict `(...a: unknown[])`
// signature, and `never[]` would forbid passing any argument at all.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = { prepare: (sql: string) => { get: (...a: any[]) => unknown } };

/**
 * Only unicode61-tokenized indexes. The porter-stemmed ones
 * (blog_posts_fts, youtube_videos_fts, embedding_chunks_fts,
 * foundation_kb_fts) store STEMS, so their df for a surface form is wrong
 * and would inflate idf.
 */
export const VOCAB_SOURCES = [
  { vocab: 'v_cips_fts', fts: 'cips_fts', base: 'cips' },
  { vocab: 'v_forum_fts', fts: 'forum_fts', base: 'forum_topics' },
  { vocab: 'v_docs_fts', fts: 'docs_fts', base: 'doc_pages' },
  { vocab: 'v_whitepapers_fts', fts: 'whitepapers_fts', base: 'whitepapers' },
  { vocab: 'v_cip_attachments_fts', fts: 'cip_attachments_fts', base: 'cip_attachments' },
] as const;

// Mirror FTS5's unicode61 tokenizer, which splits on '.', '_' and '-'. A
// tokenizer that kept "0.6.12" whole would look up a term FTS5 never indexed,
// get df=0, and hand the least informative token the maximum idf.
const TOK = /[a-z0-9]+/g;

/** Escape LIKE wildcards so a user's '%' cannot turn into a full scan match. */
export function escLike(s: string): string {
  return s.replace(/[\\%_]/g, m => '\\' + m);
}

// '%i%' matches nearly every row of any text column: as a LIKE conjunct it
// filters nothing, drags in unrelated rows, and costs the query for no
// precision gained. FTS still scores these tokens, where idf prices them
// properly — this list only gates LIKE.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'be',
  'do', 'does', 'how', 'what', 'why', 'when', 'where', 'i', 'we', 'you', 'it',
  'my', 'me', 'can', 'with', 'from', 'by', 'at', 'as', 'that', 'this',
]);

/** Tokens worth putting in a LIKE conjunct: discriminative enough to narrow. */
export function likeTokens(tokens: string[]): string[] {
  return tokens.filter(t => t.length >= 3 && !STOPWORDS.has(t));
}

export function tokenize(s: string | null | undefined): string[] {
  if (!s) return [];
  TOK.lastIndex = 0;
  return s.toLowerCase().match(TOK) ?? [];
}

export function ftsPrefixMatch(q: string | null | undefined): string | null {
  const phrase = /^\s*"([^"]+)"\s*$/.exec(q ?? '');
  if (phrase) {
    const words = tokenize(phrase[1]).slice(0, 16);
    return words.length ? `"${words.join(' ')}"` : null;
  }
  const terms = tokenize(q).slice(0, 16);
  return terms.length ? terms.map(t => `${t}*`).join(' ') : null;
}

const IDF_MIN = 0.05;
const IDF_CACHE_MAX = 5000;
const idfCache = new Map<string, number>();
let nGlobalCache: number | null = null;
let vocabWarned = false;

/** Total docs across indexed corpora; read live so it can't drift, then cached. */
function nGlobal(db: DbLike): number {
  if (nGlobalCache !== null) return nGlobalCache;
  let n = 0;
  for (const { base } of VOCAB_SOURCES) {
    try {
      n += (db.prepare(`SELECT COUNT(*) c FROM ${base}`).get() as { c: number }).c;
    } catch { /* table absent: contributes nothing */ }
  }
  nGlobalCache = Math.max(n, 1);
  return nGlobalCache;
}

/**
 * Global inverse document frequency. df is summed from EXACT-term lookups
 * across every vocab index, so df(t) <= sum of row counts = nGlobal and idf
 * is positive by construction.
 */
export function idfOf(db: DbLike, tok: string): number {
  const cached = idfCache.get(tok);
  if (cached !== undefined) return cached;

  const N = nGlobal(db);
  let df = 0;
  let anyVocab = false;
  for (const { vocab } of VOCAB_SOURCES) {
    try {
      const r = db.prepare(`SELECT coalesce(sum(doc), 0) d FROM ${vocab} WHERE term = ?`)
        .get(tok) as { d: number };
      df += r.d;
      anyVocab = true;
    } catch { /* vocab table absent: contributes 0 */ }
  }
  if (!anyVocab && !vocabWarned) {
    vocabWarned = true;
    console.warn('[rank] fts5vocab tables missing - idf degraded to uniform. Run: npx tsx scripts/migrate-vocab.ts');
  }

  df = Math.min(df, N);
  const idf = Math.max(Math.log(1 + (N - df + 0.5) / (df + 0.5)), IDF_MIN);
  if (idfCache.size >= IDF_CACHE_MAX) idfCache.delete(idfCache.keys().next().value!);
  idfCache.set(tok, idf);
  return idf;
}

/**
 * Score one result against the query: sum of idf for query tokens present,
 * weighted by where they hit. Title matches dominate because a title term is a
 * far stronger signal of aboutness than a body mention.
 */
export function scoreResult(
  db: DbLike,
  queryTokens: string[],
  title: string | null | undefined,
  excerpt: string | null | undefined,
  identity?: string | null,
): number {
  if (queryTokens.length === 0) return 0;
  // `identity` carries the id/meta (e.g. a CIP's "0001"). Without it a query
  // like "CIP-0001" scored the actual CIP at zero - its title is
  // "Chain Improvement Proposal Process and Guidelines", which contains
  // neither "cip" nor "0001" - and lost to any row with "CIP" in the title.
  const titleToks = new Set([...tokenize(title), ...tokenize(identity)]);
  const bodyToks = new Set(tokenize(excerpt));

  let score = 0;
  for (const t of queryTokens) {
    const idf = idfOf(db, t);
    if (titleToks.has(t)) score += idf * 3;
    else if (bodyToks.has(t)) score += idf;
  }
  // Reward covering more of the query rather than hammering one rare token.
  const covered = queryTokens.filter(t => titleToks.has(t) || bodyToks.has(t)).length;
  return score * (1 + covered / queryTokens.length);
}

/**
 * Order rows a query has ALREADY fetched, and take the top `limit`.
 *
 * `LIMIT N` with no `ORDER BY` is a cut with no criterion — SQLite scans in
 * rowid order, so those N are just the N rows inserted first among the
 * matches. This ranks the rows the caller's own WHERE produced (recall is
 * untouched; only the surviving N move), reusing scoreResult/idfOf rather
 * than a second parallel ranking engine — one relevance model for the whole
 * app, applied here as a reordering pass instead of a corpus-wide search.
 *
 * The caller must lift its own LIMIT to fetch the candidates first — ranking
 * a rowid-truncated sample inherits the bias this exists to remove.
 */
export function rankRows<T>(
  db: DbLike,
  q: string,
  rows: T[],
  limit: number,
  view: (r: T) => { title: string | null; body?: string | null; identity?: string | null },
): T[] {
  if (rows.length <= 1) return rows.slice(0, limit);
  const qTokens = tokenize(q);
  const scored = rows.map((row, i) => {
    const v = view(row);
    return { row, i, score: scoreResult(db, qTokens, v.title, v.body, v.identity) };
  });
  // The index breaks ties, so equal scores keep the order the query returned
  // them in and the result is stable across identical calls.
  scored.sort((a, b) => (b.score - a.score) || (a.i - b.i));
  return scored.slice(0, limit).map(s => s.row);
}
