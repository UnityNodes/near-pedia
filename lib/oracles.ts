/**
 * What each scheduled check walks, and how much of it the check can prove it
 * reached.
 *
 * THE CLASS. Every check in this repo enumerates a surface and reports a
 * verdict. Nothing until now compared the two. A check that walked most of a
 * surface, or dropped a table on a `catch { continue }`, prints the same
 * green line as one that walked all of it. The daily log recorded a number,
 * so it looked measured; the number just wasn't the denominator.
 *
 * WHAT A SECOND SOURCE MEANS HERE. `total` is only filled in where the
 * surface can be counted by a mechanism the check does not use - the schema
 * instead of a JS walk, git's index instead of readdir, the database instead
 * of a hand-written list. Where the surface IS a hand-written list inside the
 * check, there is no second source, and asserting `items === LIST.length`
 * would be a check whose two sides come from one place: it can only pass.
 * Those entries carry `total: null` and say why, and check-oracles prints how
 * many of each kind there are, so its own coverage is a number rather than an
 * impression.
 */

import type Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { NOT_INDEXED, SHARES_INDEX_TYPE } from './index-coverage';

/**
 * Which script names mark a writer, and so define the surface check-scheduled
 * walks. Lives here rather than in that script because two things need it:
 * the check, and the count below that measures the same surface from git's
 * index instead of the filesystem. Two copies of this pattern would be one
 * idea with two implementations and nothing comparing them - exactly the
 * class scripts/check-concepts.ts exists to catch, and check-scheduled.ts
 * carried its own copy of this regex until this registry unified them.
 *
 * `prune` was missing from that copy: scripts/prune-logs.ts has run in the
 * daily bucket since it was written, invisible to check-scheduled the whole
 * time because the pattern had every writer verb except that one (`clean-`
 * without `prune-`), which is why it is called out here rather than silently
 * folded in.
 */
export const WRITER_RE = /^(sync|refresh|alert|build|push|backfill|enrich|fix|migrate|clean|cleanup|check|prune)-[a-z0-9-]+\.ts$/;

export interface Oracle {
  /** Basename under scripts/, without the .ts. */
  script: string;
  /** One element of the surface, in words. Appears in the failure. */
  surface: string;
  /**
   * The name it writes to sync_log under, when that is not the script name.
   */
  source?: string;
  /**
   * An independent count of that surface, or null when no second source
   * exists. Independent means: computed here, by a route the check itself
   * does not take.
   */
  total: ((db: Database.Database) => number) | null;
  /** Why total is null, or why a shortfall against it is legitimate. */
  why?: string;
  /** A shortfall this large or smaller against `total` is expected, not a defect. */
  tolerance?: number;
  /** How much of the surface arrived AFTER the check walked it: two numbers
   *  taken at two different times can only agree by luck on a surface that
   *  grows. */
  grownSince?: (db: Database.Database, sinceIso: string) => number;
  /** Why growth cannot explain a gap here, for a surface with no first-seen
   *  clock to subtract - protected instead by running before check-oracles
   *  in the same bucket, which O5 verifies against the schedule. */
  whyGrowthCannotExplain?: string;
}

function gitFiles(pattern: string): string[] {
  return execFileSync('git', ['ls-files', pattern], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

function gitCount(pattern: string): number {
  return gitFiles(pattern).length;
}

/** Files matching `pattern` first committed after `sinceIso`. */
function gitAddedSince(pattern: string, sinceIso: string): string[] {
  const out = execFileSync(
    'git',
    ['log', `--since=${sinceIso}`, '--diff-filter=A', '--name-only', '--format=', '--', pattern],
    { encoding: 'utf8' },
  );
  const live = new Set(gitFiles(pattern));
  return [...new Set(out.split('\n').filter(Boolean))].filter(f => live.has(f));
}

/**
 * The five text columns check-corpus-text.ts walks. Named once: the `total`
 * below has to be the same surface as the check's own SURFACES or subtracting
 * one from the other means nothing. No mailing_messages entry - this app has
 * no mailing-list feature.
 */
const CORPUS_TEXT_COLUMNS: [table: string, column: string][] = [
  ['doc_pages', 'content_text'],
  ['blog_posts', 'content_text'], ['forum_posts', 'cooked'],
  ['youtube_videos', 'transcript_text'], ['github_items', 'body'],
];

export const ORACLES: Oracle[] = [
  {
    whyGrowthCannotExplain:
      'the surface is tables in sqlite_master, which change only when a sync creates one; there is no first-seen clock on a table, and this runs before check-oracles in the same bucket',
    script: 'check-db-rows',
    surface: 'a table with a generated row interface',
    total: (db) => (db.prepare(`
      SELECT COUNT(*) n FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
    `).get() as { n: number }).n,
  },
  {
    whyGrowthCannotExplain:
      'columns of real tables, same as check-db-rows: no clock exists on a column, and the walk finishes before check-oracles reads it',
    script: 'check-formats',
    surface: 'a column of a real table',
    // The check walks sqlite_master in JS and calls PRAGMA table_info per
    // table. This counts the same columns in one statement through the
    // table-valued form of the same pragma, so a table lost to the check's
    // per-table catch still lands in this total.
    total: (db) => (db.prepare(`
      SELECT COUNT(*) n FROM sqlite_master m JOIN pragma_table_info(m.name) p
      WHERE m.type = 'table'
        AND m.name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
        AND m.name NOT LIKE '%\\_fts' ESCAPE '\\'
        AND m.name NOT LIKE '%\\_fts\\_%' ESCAPE '\\'
        AND COALESCE(m.sql, '') NOT LIKE 'CREATE VIRTUAL%'
    `).get() as { n: number }).n,
  },
  {
    whyGrowthCannotExplain:
      'every one of the nine tables carries synced_at, a LAST-TOUCHED clock re-stamped by five-minute syncs; the skew is removed by running check-oracles last in the daily bucket instead',
    script: 'check-corpus-text',
    source: 'corpus-text',
    surface: 'a stored document over 500 characters, on any served text column',
    // Counted from the schema rather than from the check's own SURFACES list,
    // so a column dropped from that list shows up here as a shortfall
    // instead of quietly shrinking the walk.
    total: (db) => {
      let n = 0;
      for (const [table, column] of CORPUS_TEXT_COLUMNS) {
        n += (db.prepare(
          `SELECT COUNT(*) n FROM ${table} WHERE ${column} IS NOT NULL AND length(${column}) > 500`,
        ).get() as { n: number }).n;
      }
      return n;
    },
    tolerance: 2,
    why: 'the surface is written by five-minute syncs and this gate runs seconds after the walk; the defect it looks for is a dropped column, whose smallest instance is 7+ documents',
  },
  {
    whyGrowthCannotExplain:
      'the surface is the set of external-content FTS5 indexes, which changes only with a schema migration and carries no clock at all',
    script: 'check-fts-freshness',
    source: 'fts-freshness',
    surface: 'an external-content FTS5 index',
    // The check names its indexes by hand in INDEXES. This counts them from
    // the schema, so an index added by a migration and registered nowhere
    // shows up as a gap.
    total: (db) => (db.prepare(`
      SELECT COUNT(*) n FROM sqlite_master
      WHERE type = 'table' AND sql LIKE '%USING fts5%'
        AND sql NOT LIKE '%fts5vocab%'
        AND sql LIKE '%content=%'
    `).get() as { n: number }).n,
  },
  {
    script: 'check-scheduled',
    surface: 'a writer script',
    // readdirSync in the check; git's index here. What is shared is
    // WRITER_RE, because that pattern IS the definition of the surface -
    // check-scheduled imports it from here rather than keeping its own copy.
    total: () => gitFiles('scripts/*.ts').filter((f) => WRITER_RE.test(f.split('/').pop() ?? '')).length,
    grownSince: (_db, since) =>
      gitAddedSince('scripts/*.ts', since).filter((f) => WRITER_RE.test(f.split('/').pop() ?? '')).length,
  },
  {
    script: 'check-delete-policy',
    surface: 'a sync script',
    total: () => gitCount('scripts/sync-*.ts'),
    grownSince: (_db, since) => gitAddedSince('scripts/sync-*.ts', since).length,
  },
  {
    whyGrowthCannotExplain:
      'the surface is the published source list, which changes when a source is registered rather than continuously; ordered before check-oracles in the same bucket',
    script: 'check-source-layers',
    surface: 'a published source',
    // The check parses the sources array out of mcp-server.ts. This counts
    // the same set a different way: the distinct source_types the index
    // actually holds, plus the ones declared as deliberately not indexed.
    total: (db) => {
      const held = new Set((db.prepare('SELECT DISTINCT source_type t FROM embedding_chunks').all() as { t: string }[]).map(r => r.t));
      const sharing = Object.values(SHARES_INDEX_TYPE).filter(t => held.has(t)).length;
      return held.size + sharing + Object.keys(NOT_INDEXED).length;
    },
    why: 'the published list is parsed from source; the second count comes from the index itself plus the declared exclusions',
  },
  {
    whyGrowthCannotExplain:
      'embedding_chunks has no timestamp column, so first-seen cannot be answered; ordered before check-oracles instead',
    script: 'check-index-freshness',
    surface: 'a document held in the embedding index',
    // The check loads documents through loadAllDocs and compares what it
    // finds. This counts the distinct documents the index actually holds,
    // independent of that loader.
    total: (db) => (db.prepare(
      `SELECT COUNT(*) n FROM (SELECT DISTINCT source_type, source_id FROM embedding_chunks)`,
    ).get() as { n: number }).n,
    tolerance: 2000,
    why: 'documents whose stored hash already asked for a rebuild are reported as pending, not compared',
  },

  // ── no second source ──────────────────────────────────────────────────────
  //
  // Everything below walks a list it holds itself. The gate that still
  // applies is that the count must be a count: present, and not zero on a
  // clean run.

  { script: 'check-agent-errors', surface: 'a registered tool called by an external agent inside the window', total: null,
    why: 'the surface is exactly the set of tools external callers invoked in mcp_calls over the window, read directly by the check; the only other count of that would be the same log agreeing with itself' },
  { script: 'check-changes-parity', surface: 'a recent-activity window compared across the MCP and REST roads', total: null,
    why: 'the windows are named in the check; a second count would parse the same two roads the check already calls' },
  { script: 'check-citations', surface: 'a URL a tool hands to an agent', total: null,
    why: 'the surface is re-derived on every run from what the tools actually print, so a new link is covered the day it is emitted' },
  { script: 'check-completeness', source: 'completeness', surface: 'a source with an upstream counter', total: null,
    why: 'the upstream counters are declared per source in the check' },
  { script: 'check-completion', source: 'completion', surface: 'a bounded loop in the serving path, plus the success writes that read one', total: null,
    why: 'the site list is the check\'s own registry, and the check recomputes the surface from the code on every run and fails on any bounded loop the registry does not name, so the registry cannot drift below the code it describes' },
  { script: 'check-concepts', surface: 'a concept with more than one implementation', total: null,
    why: 'lib/concepts.ts is the registry; counting it again here would be the same list twice' },
  { script: 'check-conflict-targets', surface: 'a table written by more than one upsert', total: null,
    why: 'derived from a source scan the check owns' },
  { script: 'check-containers', surface: 'a relationship between two tables that promises one holds the other\'s contents', total: null,
    why: 'the relations are named in the check' },
  { script: 'check-corpus-balance', surface: 'an embedding source_type', total: null,
    why: 'the list is embedding_chunks\' own source_types and the thin-fraction rule lives in the check; a second count would be the same GROUP BY twice' },
  { script: 'check-counters', surface: 'a count-like column, declared derivable or upstream-only', total: null,
    why: 'the surface is re-derived from PRAGMA on every run, so a counter column added tomorrow arrives undeclared rather than unseen' },
  { script: 'check-cuts', source: 'cuts', surface: 'a serving-layer statement that ends in LIMIT, classified by whether it names which rows survive', total: null,
    why: 'the cut list is re-derived from mcp-server.ts, lib/ and app/ on every run by finding every SELECT with a LIMIT, so the denominator is the code itself' },
  { script: 'check-reranker', surface: 'a rerank probe: one call to the configured reranker provider', total: null,
    why: 'the probe is a single synthetic call against the live provider; there is no population to count' },
  { script: 'check-deadlines', surface: 'an outbound call', total: null,
    why: 'derived from a source scan the check owns' },
  { script: 'check-deployed', surface: 'a built file compared against the running build', total: null,
    why: 'the file set comes from the same stat walk the check performs' },
  { script: 'check-doc-chrome', source: 'doc-chrome', surface: 'a stored doc page checked for publisher chrome at its head and tail', total: null,
    why: 'the surface is every doc_pages row with content_text and the check walks all of them in one pass, so items IS the population; a second count of that population would be the same table read twice' },
  { script: 'check-doc-structure', source: 'doc-structure', surface: 'a doc page whose stored HTML holds a multi-line code block, checked that the served content_text keeps its newlines', total: null,
    why: 'the surface is every doc_pages row with a multi-line <pre> in content_html, re-derived from the table on each run; the two SIDES are independent - the stored HTML versus the served text derived from it' },
  { script: 'check-doc-trust', surface: 'a corpus text row scanned for language addressed to a model', total: null,
    why: 'the corpora are this check\'s own list of tables and queries; a second count of them would restate that list, and a table that fails to read is reported as a failure rather than skipped' },
  { script: 'check-ecosystem-liveness', source: 'ecosystem-liveness', surface: 'an ecosystem project with a URL', total: null,
    why: 'bounded by an env cap for partial runs; the unbounded run walks the table' },
  { script: 'check-embeddings', surface: 'an embedding probe: one call to the embedding provider semantic_search depends on', total: null,
    why: 'the probe is a single synthetic call against the live provider; there is no population to count' },
  { script: 'check-endpoints', surface: 'a published REST route', total: null,
    why: 'routes are enumerated from the app tree by the check' },
  { script: 'check-facets', source: 'facets', surface: 'an enum parameter whose vocabulary is compared to its data', total: null,
    why: 'the facet list is the check\'s own registry; the SECOND source is per-facet and already inside it - the enum comes from the schema the running server publishes, the values from the table' },
  { script: 'check-failures', surface: 'a scheduled source whose newest run was read for a failure', total: null,
    why: 'the check reads sync_log and failure_events itself and pages on what it finds; a second count would read the same rows' },
  { script: 'check-fencing', surface: 'a tool registration in mcp-server.ts', total: null,
    why: 'any second count here would parse the same file the check parses' },
  { script: 'check-handoffs', surface: 'a tool pair where one names the other as the source of an id', total: null,
    why: 'the pairs are declared in the check and asserted complete against mcp-server.ts inside it; a second count would apply the same rule to the same file' },
  { script: 'check-index-coverage', surface: 'a corpus row the embedding loader is expected to embed', total: null,
    why: 'the expected set is this check\'s own restatement of the loader filters; a second count of it would be the same predicate twice' },
  { script: 'check-index-validity', source: 'index-validity', surface: 'a status-bearing embedded row checked for a validity annotation in what semantic_search serves', total: null,
    why: 'the surface is every embedded row whose source table carries a non-current status, re-derived each run; the SIDES are the stored status versus the string semantic_search actually renders for that row' },
  { script: 'check-inputs', surface: 'a tool parameter probed with a schema-legal value', total: null,
    why: 'the parameter set is whatever the running server publishes, which is the check\'s own input' },
  { script: 'check-latency', surface: 'a timed tool call', total: null,
    why: 'the probe list is held in the check' },
  { script: 'check-lookups', source: 'lookups', surface: 'a lookup compared against the vocabulary it indexes', total: null,
    why: 'the pair list is the check\'s own registry and is deliberately small; the two SIDES of each pair are independent - keys from the map, values from the code that produces them' },
  { script: 'check-network-stats', surface: 'a network_stats snapshot metric compared to a live recount of the table it summarises', total: null,
    why: 'the metric list is the check\'s own registry; the two SIDES are independent - the figure sync-network-stats stored versus a fresh COUNT recomputed here on each run' },
  { script: 'check-oracles', surface: 'a scheduled check', total: null,
    why: 'its surface is this registry; counting it here would be the same list twice, so O1 asserts it against sync-tick instead' },
  { script: 'check-order-keys', source: 'order-keys', surface: 'a single-term serving ORDER BY on a base-table column', total: null,
    why: 'the surface is every db.prepare literal in the serving source whose ORDER BY is a lone bare column of its FROM table, enumerated in one pass over that source' },
  { script: 'check-published-totals', surface: 'a tool whose printed "N of M" is verified against the database', total: null,
    why: 'the tool list and each one\'s ground-truth SQL are declared in the check; a second list would name the same six tools again' },
  { script: 'check-qualifiers', surface: 'a declared claim graded against its query, plus every tool source-swept for two mechanical shapes', total: null,
    why: 'the one declared claim and the sweep\'s own detection rules live in the check; a second list would name the same tools it already re-derives from source on every run' },
  { script: 'check-retrieval', surface: 'a corpus-unique phrase asked of search or semantic_search', total: null,
    why: 'the targets are derived fresh from the corpus on every run rather than stored, so a second count would re-run the same derivation twice' },
  { script: 'check-prune-guards', source: 'prune-guards', surface: 'a caller of prune() plus every raw set-difference DELETE, each classified by whether it can confirm a deletion', total: null,
    why: 'both lists are re-derived from the scripts directory on every run rather than stored' },
  { script: 'check-radar-expiry', surface: 'a live radar alert whose end condition is re-evaluated against current protocol, governance and package state', total: null,
    why: 'which alerts are live is decided by the same end conditions the check evaluates; a second count would evaluate them twice' },
  { script: 'check-error-catalog', surface: 'a known NEAR error whose quote is looked up on its synced source page', total: null,
    why: 'the walk is the catalog itself (KNOWN_ERRORS in lib/near-errors.ts); counting it again from the same array proves nothing' },
  { script: 'check-radar-parity', surface: 'a radar assertion (freshness, deadline/expired flag, or live count) compared across the MCP and REST roads', total: null,
    why: 'the assertions are named in the check; the anchor is the raw radar_items table sampled independently of either road' },
  { script: 'check-reachable', surface: 'a required tool parameter classified by behaviour', total: null,
    why: 'the parameter set is the running server\'s published schema, which is also the check\'s input; coverage is reported as counted populations instead' },
  { script: 'check-release-stability', surface: 'a latest-stable pick from github_releases, checked against GitHub\'s own prerelease flag', total: null,
    why: 'the repo list is read from the table itself; a second count would re-run the same DISTINCT repo query' },
  { script: 'check-refusals', surface: 'a refusal rule', total: null,
    why: 'the rules are the check' },
  { script: 'check-served', surface: 'a tool description served to agents', total: null,
    why: 'any second count here would parse the same file the check parses' },
  { script: 'check-sources', surface: 'a table with enough rows to be a source', total: null,
    why: 'the row threshold is the check\'s own definition of the surface' },
  { script: 'check-sql', surface: 'a SQL statement found in the tree', total: null,
    why: 'statements are extracted by the check; a second extractor would be a second parser, not a second source' },
  { script: 'check-truncation', source: 'truncation', surface: 'a body cut in the serving layer, provoked on its longest row', total: null,
    why: 'the site list is the check\'s own registry, and it recomputes "how many cuts exist" from the source and compares against it: a .slice() that no site declares fails' },
  { script: 'check-upstream-echo', surface: 'a sync with an upstream count to echo', total: null,
    why: 'the echoes are declared in the check' },
  { script: 'check-version-lines', surface: 'a multi-line repo\'s get_latest_release answer, checked against latestStableByLine computed independently', total: null,
    why: 'multi-line repos are read from github_releases itself; the two SIDES are the live served tool over HTTP versus the same library function called directly here' },
  { script: 'check-vec', source: 'check-vec', surface: 'a vec0 write probe (insert+delete at a provably-free rowid)', total: null,
    why: 'the probe is a single synthetic write against the live driver; there is no population to count' },
  { script: 'check-writers-succeeding', surface: 'a scheduled writer', total: null,
    why: 'both sides would parse deploy/sync-tick.sh; that is one source read twice' },
];
