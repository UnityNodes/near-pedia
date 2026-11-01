/**
 * gov.near.org (Discourse) over its plain JSON API: which categories are
 * read, and the listing and topic documents reduced to the forum tables.
 *
 * The forum holds about 15,000 topics, most of them community and marketing
 * threads (creatives alone had 6,079 on 2026-11-01). The listings below are
 * the governance and developer ones; a parent listing already includes its
 * subcategories' topics, so House of Stake's 158 covers governance,
 * proposals and the working groups.
 */

export const FORUM_ORIGIN = 'https://gov.near.org';

export interface Listing {
  id: number;
  label: string;
  /** Read posts as well as topics: the threads an agent quotes. */
  posts: boolean;
}

export const FORUM_LISTINGS: readonly Listing[] = [
  { id: 158, label: 'House of Stake (governance, proposals, working groups)', posts: true },
  { id: 5, label: 'Staking & delegation (validator official threads, incidents)', posts: true },
  { id: 29, label: 'Dev / standards', posts: true },
  { id: 100, label: 'Dev / engineering updates', posts: true },
  { id: 68, label: 'Dev / proposals', posts: false },
];

/**
 * Where House of Stake proposals are drafted: the House of Stake category
 * and its Proposals subcategory (ids read from /categories.json on
 * 2026-11-01). An "HSP-040: …" title posted anywhere else is not a draft.
 */
export const HSP_CATEGORY_IDS: readonly number[] = [158, 168];

export interface TopicRow {
  id: number;
  title: string;
  category_id: number | null;
  created_at: string | null;
  last_post_at: string | null;
  bumped_at: string | null;
  posts_count: number;
  reply_count: number;
  views: number;
  like_count: number;
  last_poster_username: string | null;
  url: string;
  pinned: boolean;
}

interface DiscourseTopic {
  id?: number;
  title?: string;
  slug?: string;
  category_id?: number | null;
  created_at?: string | null;
  last_posted_at?: string | null;
  bumped_at?: string | null;
  posts_count?: number | null;
  reply_count?: number | null;
  views?: number | null;
  like_count?: number | null;
  last_poster_username?: string | null;
  pinned?: boolean;
}

export function topicUrl(id: number, slug?: string): string {
  return `${FORUM_ORIGIN}/t/${slug ? `${slug}/` : ''}${id}`;
}

function toRow(t: DiscourseTopic): TopicRow | null {
  if (typeof t.id !== 'number' || !t.title) return null;
  return {
    id: t.id,
    title: t.title,
    category_id: t.category_id ?? null,
    created_at: t.created_at ?? null,
    last_post_at: t.last_posted_at ?? null,
    bumped_at: t.bumped_at ?? t.last_posted_at ?? null,
    posts_count: t.posts_count ?? 0,
    reply_count: t.reply_count ?? 0,
    views: t.views ?? 0,
    like_count: t.like_count ?? 0,
    last_poster_username: t.last_poster_username ?? null,
    url: topicUrl(t.id, t.slug),
    pinned: Boolean(t.pinned),
  };
}

export function parseListing(doc: unknown): { topics: TopicRow[]; hasMore: boolean } {
  const tl = (doc as { topic_list?: { topics?: DiscourseTopic[]; more_topics_url?: string | null } } | null)?.topic_list;
  if (!tl || !Array.isArray(tl.topics)) throw new Error('not a Discourse topic listing');
  return { topics: tl.topics.map(toRow).filter((t): t is TopicRow => t !== null), hasMore: Boolean(tl.more_topics_url) };
}

export interface PostRow {
  id: number;
  topic_id: number;
  post_number: number;
  username: string | null;
  created_at: string | null;
  cooked: string;
  like_count: number;
}

interface DiscoursePost {
  id?: number;
  post_number?: number;
  username?: string | null;
  created_at?: string | null;
  cooked?: string | null;
  actions_summary?: Array<{ id: number; count?: number }>;
  hidden?: boolean;
  user_deleted?: boolean;
  deleted_at?: string | null;
}

/** Discourse counts likes as action type 2 in actions_summary. */
function likes(p: DiscoursePost): number {
  return p.actions_summary?.find((a) => a.id === 2)?.count ?? 0;
}

/**
 * Posts worth storing: not hidden by moderators, not withdrawn by their
 * author (Discourse keeps those with a placeholder body).
 */
export function toPostRows(topicId: number, posts: readonly DiscoursePost[]): PostRow[] {
  return posts
    .filter((p) => typeof p.id === 'number' && typeof p.post_number === 'number' && !p.hidden && !p.user_deleted && !p.deleted_at && p.cooked)
    .map((p) => ({ id: p.id!, topic_id: topicId, post_number: p.post_number!, username: p.username ?? null, created_at: p.created_at ?? null, cooked: p.cooked!, like_count: likes(p) }));
}

export function parseTopic(doc: unknown): { id: number; stream: number[]; posts: PostRow[] } {
  const d = doc as { id?: number; post_stream?: { stream?: number[]; posts?: DiscoursePost[] } } | null;
  if (!d || typeof d.id !== 'number' || !d.post_stream) throw new Error('not a Discourse topic');
  return { id: d.id, stream: d.post_stream.stream ?? [], posts: toPostRows(d.id, d.post_stream.posts ?? []) };
}

/**
 * The HSP number a title is: "HSP-027: Remove …", "HSP 29 – …", "DRAFT
 * HSP-030: …", "Sensing Proposal (7-Day Sensing Period) - HSP-005: …". Only
 * as the title's own prefix: a number mentioned elsewhere ("Feedback on
 * HSP-8 wording", "Constitutional Documents (HSP 008-012)", "HSP 2026
 * budget") is not the proposal the thread is, and linking by it attached the
 * wrong thread. "DRAFT HSP-XXX" has none yet.
 */
export function hspNumber(title: string): number | null {
  // A leading tag in brackets is part of the prefix: "(Deprecated) HSP-005: …", "[Ratified] HSP-008: …".
  const m = title.match(/^\s*(?:[([][^)\]]{1,20}[)\]]\s*)?(?:draft\s+)?(?:sensing proposal\s*\(7-day sensing period\)\s*[-–—]\s*)?HSP[-\s#]?0*(\d{1,3})\s*[:–—-]/i);
  return m ? Number(m[1]) : null;
}

export const isDraft = (title: string) => /^\s*draft\b/i.test(title);

/** A title without its HSP prefix, status words and punctuation, for matching an on-chain proposal to its thread. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\b(?:draft|sensing proposal|\(7-day sensing period\))\b/g, ' ')
    .replace(/\bhsp[-\s#]?(?:\d{1,4}|x+)\b\s*[:–—-]?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
