/**
 * Picking "the latest stable release" of a NEAR SDK repo, in one place.
 *
 * Every release product in lib/release-sources.ts goes through this one
 * picker (get_latest_release).
 *
 * TWO INDEPENDENT SIGNALS, AND WHY BOTH MATTER. A release's tag can look
 * stable (`v1.2.3`, no suffix) while GitHub's own `prerelease` flag says
 * otherwise, or the reverse. This has happened: an SDK shipped a clean
 * `v2.10.6` tag flagged prerelease=1, and a tag-only check served it as the
 * 2.x line's "latest stable". isStableRelease requires both signals to agree.
 *
 * WHY A LINE, NOT A DATE. A repo can publish more than one supported major
 * line at once (an LTS still taking backports alongside the current line).
 * Picking "the newest stable release" by DATE then answers with whichever
 * line shipped most recently, which is routinely the older one - multi-line
 * SDKs hit this. latestStableByLine reports the HIGHEST line
 * first, with any other still-publishing lines beside it, never below it.
 *
 * get_latest_release in mcp-server.ts used to pick `majorOf(stable[0].tag)`
 * - stable[0] being the newest STABLE-TAGGED release by date, not the
 * highest line - which is the exact same latent bug in miniature, just never
 * triggered because no repo here has published two parallel lines yet.
 * It was fixed anyway rather than waiting for it to trigger live.
 */

const STABLE_TAG_RE = /^v?\d+(?:\.\d+){1,3}$/;

export interface ReleaseRow {
  tag: string;
  name: string | null;
  published_at: string | null;
  url: string;
  repo: string;
  prerelease: number | boolean | null;
}

export interface ReleaseRef {
  version: string;
  releasedAt: string | null;
  url: string;
  repo: string;
}

function tagToVersion(tag: string): string {
  return tag.replace(/^v/, '');
}

export function isStableTag(tag: string): boolean {
  return STABLE_TAG_RE.test(tag);
}

/**
 * A release is stable only when BOTH signals agree: the tag looks like a
 * plain release version AND GitHub did not flag it a prerelease.
 * isStableTag(tag) stays for the pure tag question; picking "the latest
 * stable release" uses this.
 */
export function isStableRelease(r: { tag: string; prerelease?: number | boolean | null }): boolean {
  return isStableTag(r.tag) && !r.prerelease;
}

function toRef(r: ReleaseRow): ReleaseRef {
  return {
    version: tagToVersion(r.tag),
    releasedAt: r.published_at,
    url: r.url,
    repo: r.repo,
  };
}

export function majorOf(tag: string): number {
  return Number(tagToVersion(tag).split('.')[0]) || 0;
}

/**
 * The newest stable release of each major line a repo's rows span, HIGHEST
 * line first. A single-line repo returns one entry.
 */
export function latestStableByLine(rows: ReleaseRow[]): Array<{ line: string; latest: ReleaseRef }> {
  const byLine = new Map<string, ReleaseRow>();
  for (const r of rows) {
    if (!isStableRelease(r)) continue;
    const line = String(majorOf(r.tag));
    const held = byLine.get(line);
    // Rows are not assumed sorted: kept newest-wins so this does not depend
    // on its caller's ORDER BY.
    if (!held || Date.parse(r.published_at ?? '') > Date.parse(held.published_at ?? '')) byLine.set(line, r);
  }
  return [...byLine.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([line, r]) => ({ line, latest: toRef(r) }));
}
