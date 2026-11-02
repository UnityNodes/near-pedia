/**
 * Pure builder for the unified-activity response served by
 * /api/v1/changes. Takes the raw rows that each source query returns
 * and produces a single sorted-by-time stream, plus a counts subobject.
 *
 * Kept pure so the response shape is testable without a DB.
 */

export type ActivityKind =
  | 'new_forum_topic'
  | 'new_blog_post'
  | 'new_release'
  | 'new_radar_item'
  /** A change the NEAR syncs observed: a repo archived, a package deprecated, a release, a protocol upgrade, an incident, a vote. */
  | 'change_event';

export interface ActivityItem {
  kind: ActivityKind;
  /** ISO-8601 timestamp string */
  when: string;
  /** Stable id within the kind - used for de-dup on the consumer side */
  id: string;
  /** One-line title shown to the agent / user */
  title: string;
  /** Canonical NEAR-pedia URL when applicable, else null */
  url: string | null;
  /** Free-form extra fields per kind (status, repo, level, group, etc.) */
  meta?: Record<string, unknown>;
}

export interface ActivityStream {
  window_days: number;
  total: number;
  counts: Record<ActivityKind, number>;
  items: ActivityItem[];
}

const EMPTY_COUNTS: Record<ActivityKind, number> = {
  new_forum_topic: 0,
  new_blog_post: 0,
  new_release: 0,
  new_radar_item: 0,
  change_event: 0,
};

/**
 * Merges per-source ActivityItem lists into one descending-by-when
 * stream, capped at `limit` items overall. Each source list MAY be
 * empty; counts always reflect what was passed in (pre-limit).
 */
export function mergeActivityStream(
  windowDays: number,
  sources: Partial<Record<ActivityKind, ActivityItem[]>>,
  limit: number,
): ActivityStream {
  const counts: Record<ActivityKind, number> = { ...EMPTY_COUNTS };
  const merged: ActivityItem[] = [];
  for (const [kind, list] of Object.entries(sources) as [ActivityKind, ActivityItem[] | undefined][]) {
    if (!Array.isArray(list)) continue;
    counts[kind] = list.length;
    for (const item of list) merged.push(item);
  }

  merged.sort((a, b) => {
    // Descending by ISO timestamp string - lexicographic compare is
    // safe for ISO-8601 same-shape strings.
    if (a.when === b.when) return a.id < b.id ? -1 : 1;
    return a.when < b.when ? 1 : -1;
  });

  const items = merged.slice(0, limit);
  return { window_days: windowDays, total: items.length, counts, items };
}
