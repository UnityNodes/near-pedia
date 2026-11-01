/**
 * What nearpedia refuses to hold, in one place, so every door reads one rulebook.
 *
 * A refusal is a statement about what we HOLD, not about what we let in next.
 * That distinction is the whole file. A rule enforced at the moment of insert
 * says nothing about the rows already in the table, and nothing about the
 * other doors into it - a sync that refuses to STORE a shape going forward
 * never revisits the rows that landed before the refusal existed, and a row
 * a sync deletes because it should never have been held can be reintroduced
 * by a different code path that consults no list at all.
 *
 * So the rules live here, the syncs import them, and scripts/check-refusals.ts
 * asks the tables. The check is the only thing that can see a leak, because
 * the table is where every door ends up regardless of which one was wrong.
 *
 * REGISTERING a rule (bottom of this file) is what makes it enforced against
 * held rows. A rule that is not row-decidable cannot be registered, and that
 * is a real limit rather than an oversight: say so in NOT_ROW_DECIDABLE.
 *
 * SCOPE IS PART OF THE RULE. doc_pages is shared by more than one writer
 * (sync-docs.ts's own header names enrich-docs.ts's repo-name/adr/rpc rows
 * and hand-seeded *.md rows under the same source='docs' label), so a rule
 * about sync-docs.ts's output is scoped to the URL namespace and source it
 * actually owns, not the whole table.
 */

/** A row as read back out of the table the rule governs. */
export type HeldRow = Record<string, unknown>;

export interface Refusal {
  /** Stable id, used in check output. */
  id: string;
  /** One line: what upstream thing this refuses, in plain words. */
  what: string;
  /** The table the rule is a statement about. */
  table: string;
  /**
   * Rows the rule governs. Narrow it to the sources whose sync owns the
   * rule; a rule pointed at rows it was never about is a permanent false
   * alarm.
   */
  sql: string;
  /** True when this held row is one we have said we do not hold. */
  refuses(row: HeldRow): boolean;
  /** How to name an offending row in the report. */
  label(row: HeldRow): string;
}

// ---------------------------------------------------------------------------
// blog.yourchain.example
// ---------------------------------------------------------------------------

/** sync-blog.ts:28 - image assets and the sitemap file itself are not posts. */
const BLOG_NOT_A_POST = /\/content\/images\/|\/sitemap-posts\.xml$/;

// ---------------------------------------------------------------------------
// forum.yourchain.example
// ---------------------------------------------------------------------------

/**
 * Topics we never want indexed. Empty on purpose: a full scan of every
 * quiet, one-shot topic in the corpus (255 topics, 2026-09) found nothing
 * that looked like spam - validator announcements, CIP drafts, category-
 * intro posts, none of it promotional. Add an id here the day a real one
 * shows up, so a recurring spammer re-creating the thread under a new id
 * can be added in one line.
 *
 * Deliberately NOT scored by category: forum.yourchain.example has no
 * low-moderation category that spam tends to land in
 * (scripts/refresh-radar.ts documents the same absence), so there is no
 * category-based signal, only whatever a title itself says.
 */
export const SPAM_TOPIC_IDS = new Set<number>([]);

/**
 * Title patterns that are almost always spam anywhere, not tuned to any one
 * community's incident history. Kept deliberately narrow: a title merely
 * looking odd is the weakest possible evidence of bad faith and the
 * strongest possible way to hide a real question - a name naively matching
 * "License. Larifi..." style openers has flagged legitimate licensing
 * questions before, which is why that
 * kind of boilerplate-opener guess is not repeated here. Keyed on what spam
 * SELLS instead.
 */
export const SPAM_TITLE_PATTERNS: RegExp[] = [
  /\b(viagra|casino|payday\s+loan)\b/i,
];

/**
 * Narrower than the full Discourse topic shape on purpose: scripts/sync-forum.ts
 * and scripts/audit-forum-spam.ts both need to ask this same question rather
 * than carry their own copy of the rule.
 */
export function isSpamTopic(t: { id: number; title: string }): boolean {
  if (SPAM_TOPIC_IDS.has(t.id)) return true;
  for (const re of SPAM_TITLE_PATTERNS) if (re.test(t.title)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// docs.yourchain.example
// ---------------------------------------------------------------------------

/** sync-docs.ts:94 - only pages under this host are this sync's own. */
const DOCS_HOST = 'https://docs.yourchain.example/';

// ---------------------------------------------------------------------------
// arXiv relevance
// ---------------------------------------------------------------------------

/**
 * sync-papers.ts:16 - the same regex the sync tests title+summary against
 * before storing an arXiv result. Scoped to arxiv-* slugs only: iacr-*
 * whitepapers are hardcoded and curated, deliberately bypassing this filter.
 */
const PAPER_RELEVANT = /yourchain|your topic/i;

// ---------------------------------------------------------------------------
// radar_items (refresh-radar.ts)
// ---------------------------------------------------------------------------

/** refresh-radar.ts's processForumOutreach: on-topic vs junk keywords. */
const RADAR_FORUM_ON_TOPIC = /grant|CIP|governance|vote|proposal|launch|partner|integrat|ecosystem|new app|mainnet|approved/i;
const RADAR_FORUM_JUNK = /balance 0|help|issue|error|problem/i;

export const REFUSALS: Refusal[] = [
  {
    id: 'forum-topic-spam',
    what: 'a forum_topics row on the declared spam blocklist or matching a spam title pattern',
    table: 'forum_topics',
    sql: `SELECT id, title FROM forum_topics`,
    refuses: (r) => isSpamTopic({ id: Number(r.id), title: String(r.title ?? '') }),
    label: (r) => `${r.id} (${r.title})`,
  },
  {
    id: 'blog-not-a-post-url',
    what: 'a blog_posts row whose url is a content image asset or the sitemap file itself, not an article',
    table: 'blog_posts',
    sql: `SELECT id, url FROM blog_posts WHERE url IS NOT NULL`,
    refuses: (r) => BLOG_NOT_A_POST.test(String(r.url ?? '')),
    label: (r) => `${r.id} (${r.url})`,
  },
  {
    id: 'docs-empty-content',
    what: 'a doc_pages row from sync-docs.ts (source=docs) with no content_text after trimming',
    table: 'doc_pages',
    sql: `SELECT id, url, content_text FROM doc_pages WHERE source = 'docs'`,
    refuses: (r) => !String(r.content_text ?? '').trim(),
    label: (r) => `${r.id} (${r.url})`,
  },
  {
    id: 'docs-host-guard',
    what: "a doc_pages row that is neither sync-docs.ts's own output (under docs.yourchain.example) nor the other known, legitimate source='docs' content (github.com/yoursdk/docs/*.md - sync-docs.ts's own prune-scope comment names this coexistence explicitly, since it deletes by URL namespace rather than by source for exactly this reason)",
    table: 'doc_pages',
    sql: `SELECT id, url FROM doc_pages WHERE source = 'docs'`,
    refuses: (r) => {
      const url = String(r.url ?? '');
      if (url.startsWith(DOCS_HOST)) return false;
      if (/^https:\/\/github\.com\/yoursdk\/docs\/.*\.md$/.test(url)) return false;
      return true;
    },
    label: (r) => `${r.id} (${r.url})`,
  },
  {
    id: 'ecosystem-missing-title-or-url',
    what: 'an ecosystem_projects row with no title or no url; sync-ecosystem.ts refuses to insert one, and unlike cip_attachments this is not schema-enforced (no NOT NULL on either column)',
    table: 'ecosystem_projects',
    sql: `SELECT slug, title, url FROM ecosystem_projects`,
    refuses: (r) => !String(r.title ?? '').trim() || !String(r.url ?? '').trim(),
    label: (r) => `${r.slug}`,
  },
  {
    id: 'whitepaper-arxiv-relevance',
    what: 'an arXiv-sourced whitepaper whose title+summary does not match sync-papers.ts\'s RELEVANT topic filter',
    table: 'whitepapers',
    sql: `SELECT id, slug, content_text FROM whitepapers WHERE slug LIKE 'arxiv-%'`,
    refuses: (r) => !PAPER_RELEVANT.test(String(r.content_text ?? '')),
    label: (r) => `${r.slug}`,
  },
  {
    id: 'youtube-transcript-too-short',
    what: 'a stored transcript_text of 50 characters or fewer; sync-youtube-transcripts.ts treats that length as "no real transcript" and never writes it via its own path, so a held one this short can only have come from elsewhere',
    table: 'youtube_videos',
    sql: `SELECT id, transcript_text FROM youtube_videos WHERE transcript_text IS NOT NULL`,
    refuses: (r) => String(r.transcript_text ?? '').length <= 50,
    label: (r) => `${r.id}`,
  },
  {
    id: 'radar-forum-junk-keywords',
    what: 'a forum_ecosystem radar item whose title fails refresh-radar.ts\'s own on-topic/junk keyword gate',
    table: 'radar_items',
    sql: `SELECT id, title FROM radar_items WHERE source_type = 'forum_ecosystem'`,
    refuses: (r) => {
      const t = String(r.title ?? '');
      return RADAR_FORUM_JUNK.test(t) || !RADAR_FORUM_ON_TOPIC.test(t);
    },
    label: (r) => `${r.id} (${r.title})`,
  },
  {
    id: 'radar-github-release-snapshot-rc',
    what: 'a github_release radar item pointing at a snapshot/rc-tagged release, which refresh-radar.ts excludes at query time',
    table: 'radar_items',
    sql: `
      SELECT ri.id, gr.tag FROM radar_items ri
      JOIN github_releases gr ON gr.id = ri.source_id
      WHERE ri.source_type = 'github_release'
    `,
    refuses: (r) => /-snapshot|-rc/i.test(String(r.tag ?? '')),
    label: (r) => `${r.id} (${r.tag})`,
  },
  {
    id: 'radar-github-breaking-bot-or-non-breaking',
    what: 'a github_issue radar item that is a dependency-bump/CI bot item, or whose body does not mention a breaking-change phrase, both excluded by refresh-radar.ts\'s query',
    table: 'radar_items',
    sql: `
      SELECT ri.id, gi.title, gi.body FROM radar_items ri
      JOIN github_items gi ON gi.id = ri.source_id
      WHERE ri.source_type = 'github_issue'
    `,
    refuses: (r) => {
      const title = String(r.title ?? '');
      const body = String(r.body ?? '').toLowerCase();
      if (/^Bump |^\[ci\]|^chore\(deps\)/.test(title)) return true;
      return !/breaking change|mandatory|must upgrade/.test(body);
    },
    label: (r) => `${r.id} (${r.title})`,
  },
];

/**
 * Refusals that cannot be re-decided from a stored row, named with why.
 *
 * A refusal that depends on state that never reaches the table - an HTTP
 * response header, an upstream "does this URL still 404" probe, an upstream
 * draft flag with no persisted column - cannot be checked against held rows,
 * and leaving it unlisted would read as coverage nobody wrote down.
 */
export const NOT_ROW_DECIDABLE: Record<string, string> = {
  'sync-cip-assets.ts:prune-on-confirmed-404':
    'deletes cip_attachments rows whose github_url no longer resolves upstream (confirmed by a live probe, guarded at a 20% max-delete ratio). Whether a currently-held row is stale depends on an HTTP check against GitHub right now, not any stored column',
  'sync-docs.ts:prune-ratio-guard':
    'deletes doc_pages rows (source=docs, under docs.yourchain.example, non-.md) no longer listed in the current llms-full.txt fetch, refusing above a 20% delete ratio. "Still published upstream" is upstream-only state; when the ratio guard trips, stale rows are left in place with nothing on the row marking them as such',
  'sync-github-releases.ts:draft-filter':
    'filters out draft releases (line 97: releases.filter(r => !r.draft)) before writing github_releases or mirroring into blog_posts. github_releases has no draft column at all - the evidence a release was a draft never reaches either table, so a held row can never be re-tested for this after the fact',
};
