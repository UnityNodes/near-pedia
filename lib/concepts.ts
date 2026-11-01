/**
 * Concepts this repo implements more than once.
 *
 * THE CLASS. One idea, several implementations, and nothing compares them. It is
 * not "duplicated code" - duplication on its own is harmless. It bites when the
 * output is an IDENTITY or a DECISION, because then two copies drifting apart
 * means two answers to a question that has one. This has happened twice: a
 * version comparator that answered 2.0.0 is newer than 2.0.1-rc1 while two
 * siblings answered correctly, and a date formatter that the MCP layer learned
 * a repair for while the web layer printed a raw "20-06-2025" for a header
 * reading "2025-06-203".
 *
 * WHAT MAKES A CONCEPT WORTH CHECKING. Not the number of copies. The question
 * is whether two implementations ever see the SAME input and feed the SAME
 * decision. `slugify` has two distinct bodies here and it does not matter:
 * sync-ecosystem slugs a project title into ecosystem_projects.slug and
 * app/docs/[id]/page.tsx slugs a heading into an anchor id it also reads back
 * off the element it just wrote - no shared input, no shared column, no
 * defect. Asserting they agree would be a contract nobody signed - a mistake
 * an earlier check-formats rule made on its first run (115,354 non-findings).
 *
 * So SHARED is the gate, and it is recorded per concept with the reason.
 */

export interface Impl {
  /** Repo-relative path. */
  file: string;
  /** The function's name in that file. */
  fn: string;
  /**
   * Why this one copy cannot be run outside its module. Set it and the copy is
   * still required to EXIST and still counted, but is left out of the
   * behavioural comparison - with the reason printed, so it does not read as
   * covered. Per implementation rather than per concept, because a concept can
   * have several copies that evaluate and one that closes over a parser.
   */
  notEvaluable?: string;
}

export interface Concept {
  name: string;
  /** Why two answers here would be one answer too many. */
  stake: string;
  /** Where the implementations meet: a column, or a decision. */
  shared: string;
  impls: Impl[];
  /**
   * SQL returning the real inputs to run every implementation over. One column,
   * aliased `v`. Real corpus rather than invented cases: a synthetic input set
   * proves the implementations agree about the cases I thought of.
   */
  corpusSql: string;
  /**
   * Set when the implementations cannot be evaluated standalone - they close
   * over an import, a DOM object, a database handle. Those are compared by
   * presence only (a new copy appearing is itself a finding) and the reason is
   * printed rather than left looking like coverage.
   */
  notEvaluable?: string;
  /**
   * A function of the same NAME that is a different idea, and why.
   *
   * The undeclared-copy scan matches on the name alone, which is the right
   * default - a copy nobody remembered is the failure that matters. But a name
   * is not a concept, and declaring an exception here keeps the scan strict
   * everywhere else instead of loosening it for everyone.
   */
  sameNameDifferentIdea?: { file: string; why: string }[];
}

export const CONCEPTS: Concept[] = [
  {
    name: 'parsePublishDate',
    stake:
      'When a YouTube video was published. sync-youtube writes it on first discovery and '
      + 'backfill-video-dates writes it on repair, so both feed youtube_videos.published_at '
      + '- a disagreement means the date a video shows depends on which of the two last '
      + 'touched the row, and the site sorts /videos by this column.',
    shared: 'youtube_videos.published_at',
    impls: [
      { file: 'scripts/sync-youtube.ts', fn: 'parsePublishDate' },
      { file: 'scripts/backfill-video-dates.ts', fn: 'parsePublishDate' },
    ],
    // The stored column is the OUTPUT of these functions, not their input, so
    // it alone would only prove idempotence. Both are fed the same upstream
    // regex (`"publishDate":{"simpleText":"..."}`) which YouTube renders as a
    // human date like "Jul 24, 2026"; the other two patterns backfill-video-dates
    // also tries (`uploadDate`, `datePublished`) render ISO instants. Union in
    // both raw shapes plus the stored values, not just what already parsed clean.
    corpusSql: `SELECT DISTINCT published_at v FROM youtube_videos WHERE published_at IS NOT NULL
                UNION SELECT 'Jul 24, 2026' UNION SELECT 'Oct 28, 2025'
                UNION SELECT '2025-10-28T00:00:00-07:00' UNION SELECT '2025-10-28'
                UNION SELECT '' UNION SELECT 'not a date'`,
  },
  {
    name: 'escLike',
    stake:
      'Whether a literal `%`, `_` or `\\` in a search query is treated as a SQL LIKE '
      + 'wildcard or as the character the visitor typed. lib/rank.ts backs get_faq and other '
      + 'MCP lookups; lib/search.ts backs the web /search page and semantic_search fallback. '
      + 'A drift here means the same query returns different rows - or a broken pattern - '
      + 'depending on which surface answered it.',
    shared: 'the LIKE-escaping contract feeding every LIKE clause built from user input',
    impls: [
      { file: 'lib/rank.ts', fn: 'escLike' },
      { file: 'lib/search.ts', fn: 'escLike' },
    ],
    corpusSql: `SELECT v FROM (SELECT DISTINCT query v FROM search_log WHERE query LIKE '%\\%%' ESCAPE '\\' OR query LIKE '%\\_%' ESCAPE '\\' ORDER BY query LIMIT 200)
                UNION SELECT '100% uptime' UNION SELECT 'snake_case' UNION SELECT 'a\\b'
                UNION SELECT '%%%' UNION SELECT ''`,
  },
];

/**
 * Concepts with more than one implementation that are deliberately NOT asserted
 * to agree, each with the reason. Without this the registry would read as though
 * the whole duplicate surface were covered.
 */
export const NOT_SHARED: { name: string; impls: number; why: string }[] = [
  {
    name: 'slugify', impls: 2,
    why:
      'sync-ecosystem.ts slugs a project title into ecosystem_projects.slug (ASCII-fold, '
      + 'hyphenate, cap at 60 chars); app/docs/[id]/page.tsx slugs a rendered heading into an '
      + 'anchor id it injects and reads back off the same element, never a stored column. '
      + 'No shared input, no shared column.',
  },
  {
    name: 'buildUrl', impls: 10,
    why:
      'One per listing page (releases, videos, discussions, search, cips, blog, docs, code, '
      + 'radar, ecosystem), each assembling that page\'s own query-string shape from its own '
      + 'filter state. Same name, ten different jobs.',
  },
  {
    name: 'fetchJson', impls: 2,
    why:
      'lib/onchain.ts calls a YourChain RPC endpoint with a fixed timeout; sync-github-items.ts '
      + 'calls the GitHub REST API with auth headers and rate-limit handling. Different '
      + 'upstreams, different error shapes, no shared input.',
  },
  {
    name: 'sleep / delay', impls: 2,
    why:
      'A pause between requests, in lib/confirm-gone.ts and sync-youtube.ts. No shared input '
      + 'and no shared column - the only contract is that some time passes.',
  },
];
