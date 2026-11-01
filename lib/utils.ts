/**
 * The `YYYY-MM-DD` head of a date-shaped string, or null if it is not really
 * one.
 *
 * `/^(\d{4})-(\d{2})-(\d{2})/` alone matches the first ten characters of
 * anything starting that way, including "2025-06-203" (there is no day 203)
 * and "2025-05-09 (reset 2025-08-13)" - both real values this app's own
 * author-typed date columns can hold, since nothing upstream validates them
 * before they are stored. The old formatDate matched that prefix and printed
 * a confident wrong date; the round-trip through `date()` below is what
 * refuses a day that does not exist rather than rendering it anyway.
 */
export function isoDateHead(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}\S*))?$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  // Round-trip, so 2025-02-31 is rejected rather than rolled into March.
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const iso = isoDateHead(dateStr);
  if (!iso) return dateStr;
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

export function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const iso = isoDateHead(dateStr);
  // Not a date. It is still what the source says, and '-' would throw that
  // away: an author-typed placeholder like "TBD" is a real answer to "when
  // was this approved".
  if (!iso) return dateStr;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC',
  });
}

export function formatDateLong(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const iso = isoDateHead(dateStr);
  if (!iso) return dateStr;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

export function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffHr < 1) return `${diffMin}m ago`;
  if (diffDay < 1) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;

  return new Date(isoDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function formatRelativeDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffDay = Math.floor(diffMs / 86_400_000);
    const diffMo = Math.floor(diffDay / 30);
    const diffYr = Math.floor(diffDay / 365);
    if (diffDay < 1) return 'today';
    if (diffDay < 30) return `${diffDay}d ago`;
    if (diffMo < 12) return `${diffMo}mo ago`;
    return `${diffYr}yr ago`;
  } catch {
    return '-';
  }
}

/**
 * CIP author fields arrive as GitHub-frontmatter markdown, e.g.
 *   "[@example-user](https://github.com/example-user)"
 *   "Jane Doe ([@jane-doe](https://github.com/jane-doe))"
 * Strip markdown links to their label so the UI shows a clean name
 * ("@example-user", "Jane Doe (@jane-doe)") instead of raw markdown plus a long
 * URL that overflows table columns. Returns '' for empty input.
 */
export function formatAuthor(author: string | null | undefined): string {
  if (!author) return '';
  return author.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
}

/**
 * A kebab-case source slug (a hostname-derived key like "github-code" or
 * "explorer-io"), title-cased word by word. Used as the fallback label for
 * any source a curated display-name map hasn't named explicitly, so an
 * unnamed source reads as "Explorer Docs" rather than a shouting
 * "EXPLORER-DOCS" once a UI stops uppercase-transforming labels in CSS.
 * Mechanical only: it corrects casing on well-known multi-word brand names
 * (GitHub, npm) and otherwise just capitalizes each hyphen-separated word,
 * never inventing or reformatting the underlying identifier.
 */
const SLUG_WORD_CASE: Record<string, string> = {
  github: 'GitHub',
  npm: 'npm',
  pm: 'PM',
  io: 'io',
  com: 'com',
};

export function titleCaseSlug(slug: string): string {
  return slug
    .split('-')
    .map(w => SLUG_WORD_CASE[w.toLowerCase()] ?? (w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/**
 * A user-assigned hex color (e.g. a forum category's Discourse color),
 * normalized to a "#rrggbb" CSS value, with a theme-aware neutral fallback
 * when the color is missing OR too close to black/white to read as a color
 * swatch at all. Forum categories set to #000000 in Discourse render as-is
 * against this site's near-black dark-theme card background, and the
 * reverse failure (near-white on a light card) is the same bug with the
 * sign flipped. Neither is a color this site chose, so the fallback is not
 * a correction of their intent, just a refusal to render a swatch nobody
 * could see.
 */
export function readableAccentColor(hex: string | null | undefined): string {
  if (!hex) return 'var(--fg-mute-text)';
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return 'var(--fg-mute-text)';
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luminance < 0.12 || luminance > 0.94) return 'var(--fg-mute-text)';
  return `#${clean}`;
}
