/**
 * Pure aggregator for CSP violation rows.
 *
 * Input shape comes from csp_violation_log SELECT (see lib/db.ts):
 *   { timestamp, violated_directive, blocked_uri }
 *
 * Output groups by directive (script-src, style-src…) and lists the
 * top-N most-blocked URIs under each. Aggregated only - no IPs and no
 * document_uri ever leak, so the REST endpoint that wraps this is
 * safe to expose unauthenticated.
 */

export interface CspViolationRow {
  timestamp: number | null;
  violated_directive: string | null;
  blocked_uri: string | null;
}

export interface CspDirectiveGroup {
  directive: string;
  count: number;
  last_seen: number | null;
  top_blocked_uris: { uri: string; n: number }[];
}

const DEFAULT_TOP_URIS_PER_DIRECTIVE = 5;

export function aggregateCspGroups(
  rows: CspViolationRow[],
  topUrisPerDirective: number = DEFAULT_TOP_URIS_PER_DIRECTIVE,
): CspDirectiveGroup[] {
  const byDir = new Map<string, { count: number; last_seen: number | null; uriCounts: Map<string, number> }>();

  for (const r of rows) {
    const dir = (r.violated_directive ?? 'unknown').trim() || 'unknown';
    const uri = (r.blocked_uri ?? 'inline').trim() || 'inline';
    const bucket = byDir.get(dir) ?? { count: 0, last_seen: null, uriCounts: new Map() };
    bucket.count += 1;
    if (r.timestamp != null && (bucket.last_seen == null || r.timestamp > bucket.last_seen)) {
      bucket.last_seen = r.timestamp;
    }
    bucket.uriCounts.set(uri, (bucket.uriCounts.get(uri) ?? 0) + 1);
    byDir.set(dir, bucket);
  }

  const groups: CspDirectiveGroup[] = [];
  for (const [directive, b] of byDir) {
    const top = [...b.uriCounts.entries()]
      .sort((a, c) => c[1] - a[1] || a[0].localeCompare(c[0]))
      .slice(0, topUrisPerDirective)
      .map(([uri, n]) => ({ uri, n }));
    groups.push({ directive, count: b.count, last_seen: b.last_seen, top_blocked_uris: top });
  }

  groups.sort((a, b) => b.count - a.count || a.directive.localeCompare(b.directive));
  return groups;
}
