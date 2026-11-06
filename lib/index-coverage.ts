import { KIND_SQL } from './blog';

/**
 * What the embedding index is supposed to hold, and what it may leave out.
 *
 * THE SEAM NOBODY CROSSES. A row can be accepted, stored, parsed, counted,
 * published and served while never reaching the vector index, and every
 * standing check stays green. check-index-freshness compares chunks against
 * the text they were built from, but it skips a document with zero chunks by
 * name - "not embedded yet; not this check's question". So the one number
 * that says how much of the corpus is reachable by semantic_search is
 * computed nowhere.
 *
 * WHAT COUNTS AS EXCLUDED. build-embeddings applies a length or emptiness
 * rule per source (scripts/build-embeddings.ts). Those rules are restated
 * here as SQL so this file can ask the database the same question the loader
 * asks, from the other side. Restating rather than importing is deliberate:
 * importing loadAllDocs would make both sides one source, and a check whose
 * two sides come from one place can only pass. When the loader's rule
 * changes and this one does not, the two disagree and that IS the finding.
 */

export interface IndexedSource {
  /** source_type as written into embedding_chunks. */
  type: string;
  table: string;
  /** SQL producing the value build-embeddings writes as source_id. */
  keyExpr: string;
  /** Column carrying the row's own recency, for telling lag from a gap. */
  syncedAt: string | null;
  /**
   * The rows build-embeddings is expected to have embedded, as a WHERE
   * clause. Restates the loader's own filter - see the file header on why it
   * is restated rather than imported.
   */
  where: string;
  /** Why rows outside `where` are not a gap. */
  why: string;
}

/**
 * Which published source each embedded source_type is, and which published
 * sources are deliberately NOT embedded.
 *
 * doc -> doc_page is a genuine vocabulary difference: /api/v1/sources names
 * the column source, the loader names the concept the row represents.
 *
 * github_item needed no mapping once it meant github_item: it used to embed
 * as 'proposal' (a leftover label from a loader that split github_items by
 * repo, which this project has no need for). Renamed to 'github_item' across
 * build-embeddings.ts, mcp-server.ts's facet enum and citation builder,
 * lib/source-urls.ts, and a one-time data migration on the ~2100 already-embedded rows.
 */
export const SHARES_INDEX_TYPE: Record<string, string> = {};

export const PUBLISHED_TO_INDEXED: Record<string, string> = {
  doc: 'doc_page',
  ...SHARES_INDEX_TYPE,
};

/**
 * Published sources that are deliberately not in the vector index, and why.
 *
 * 'embedding_chunk' is not here: /api/v1/sources appends it with .push()
 * after the literal array this check parses, so it never reaches `published`.
 */
export const NOT_INDEXED: Record<string, string> = {
  package: 'a registry record (name, version line, deprecation, yank), not prose; looked up by exact name through resolve_package, check_deprecation and check_code',
  github_repo: 'a repository record (name, archived flag, description line); looked up by exact name through check_deprecation and check_code, and its issues, releases and discussions are indexed as their own sources',
  hos_proposal: 'a House of Stake proposal whose vote standing changes while it is open, which a meaning index would serve stale; found by text and read through list_proposals and get_proposal',
  nep_standard: 'a NEAR standard addressed by its number; found by words and read in full through get_standard, and the issues and pull requests of near/NEPs are indexed as github_item',
  incident: 'a DefiLlama hack record (date, amount, technique), not prose; read through list_incidents and get_incident',
};

export const INDEXED_SOURCES: IndexedSource[] = [
  { type: 'forum_topic', table: 'forum_topics', keyExpr: 'id', syncedAt: 'synced_at',
    where: "title IS NOT NULL AND trim(title) != ''",
    why: "scripts/build-embeddings.ts:39-47. The loader embeds a topic when its title-plus-posts text is non-empty after trimming; approximated here as a non-empty title, since a real forum topic with an empty title and zero posts is not a state the sync produces" },

  { type: 'blog_post', table: 'blog_posts', keyExpr: 'id', syncedAt: 'synced_at',
    where: `content_text IS NOT NULL AND ${KIND_SQL} != 'release'`,
    why: 'scripts/build-embeddings.ts, blog_posts. Release notes copied into blog_posts are left out: they are embedded once, as github_release' },

  { type: 'github_item', table: 'github_items', keyExpr: 'id', syncedAt: 'synced_at',
    where: "body IS NOT NULL AND body != ''",
    why: 'scripts/build-embeddings.ts:61-69. A GitHub issue/PR with no body has nothing to embed' },

  { type: 'doc_page', table: 'doc_pages', keyExpr: 'id', syncedAt: 'synced_at',
    where: 'content_text IS NOT NULL',
    why: 'scripts/build-embeddings.ts:72-77' },

  { type: 'youtube_video', table: 'youtube_videos', keyExpr: 'id', syncedAt: 'synced_at',
    where: "title IS NOT NULL AND (trim(COALESCE(description, '')) != '' OR trim(COALESCE(transcript_text, '')) != '') AND length(COALESCE(title,'') || COALESCE(description,'') || COALESCE(transcript_text,'')) > 30",
    why: 'scripts/build-embeddings.ts, youtube_videos. A video with only its title is left to full-text search until its description or transcript is read' },

  { type: 'github_release', table: 'github_releases', keyExpr: 'id', syncedAt: 'synced_at',
    where: "published_at IS NOT NULL AND trim(COALESCE(body, '')) != ''",
    why: "scripts/build-embeddings.ts, github_releases. Drafts (no published_at) and releases with no notes, which are only their tag, are not embedded" },

  { type: 'ecosystem_project', table: 'ecosystem_projects', keyExpr: 'slug', syncedAt: 'synced_at',
    where: "description IS NOT NULL AND length(COALESCE(title,'') || COALESCE(description,'')) > 10",
    why: 'scripts/build-embeddings.ts:121-127. slug is the table\'s actual PRIMARY KEY' },

  { type: 'github_discussion', table: 'github_discussions', keyExpr: 'id', syncedAt: 'synced_at',
    where: 'body IS NOT NULL',
    why: "scripts/build-embeddings.ts:134-151. The loader also requires the joined repo+title+body+comments text to exceed 30 chars, which a non-null body plus its repo/title prefix clears in every observed row" },

  { type: 'radar_item', table: 'radar_items', keyExpr: 'id', syncedAt: 'created_at',
    where: "body IS NOT NULL AND body != '' AND length(COALESCE(level,'') || COALESCE(title,'') || body) > 30",
    why: 'scripts/build-embeddings.ts:172-178' },
];

/**
 * How far behind the last embedding run a row may be and still count as lag
 * rather than a gap.
 *
 * build-embeddings runs in the slow bucket, every six hours (deploy/sync-tick.sh).
 * A row synced after the last run has not had its chance yet, and calling that
 * a defect would make this check red for most of every day.
 */
export const EMBED_LAG_GRACE_HOURS = 8;
