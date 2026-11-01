/**
 * Auto-link CIP-N mentions in text/HTML to /cips/NNNN.
 *
 * Pure function, no DB. Used by forum post sanitizer downstream renders
 * and the digest builder. Keep it regex-only so the same logic can run
 * server-side in a Node script as well as client-side.
 *
 * Accepted forms:
 *   CIP-42
 *   CIP-0042
 *   CIP 0042   (space, sometimes seen in mailing-list quoting)
 *   cip-42     (case-insensitive match, output preserves canonical form)
 *
 * Padded to 4 digits because your-org/CIPs uses zero-padded
 * directory names (CIP-0001/, CIP-0042/) and our /cips/[id] route
 * redirects bare numbers to padded.
 */

const CIP_PATTERN = /\bCIP[-\s]?(\d{1,4})\b/gi;

function replaceCipsInText(segment: string): string {
  return segment.replace(CIP_PATTERN, (_, num) => {
    const padded = String(num).padStart(4, '0');
    return `<a href="/cips/${padded}">CIP-${padded}</a>`;
  });
}

export function autolinkCips(text: string, opts: { skipInsideTags?: boolean } = {}): string {
  if (!text) return text;
  if (!opts.skipInsideTags) return replaceCipsInText(text);

  // Walk the input, tracking <a> nesting so existing anchors are never
  // double-wrapped. Tags themselves pass through unchanged.
  const out: string[] = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  let last = 0;
  let anchorDepth = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text)) !== null) {
    const between = text.slice(last, m.index);
    out.push(anchorDepth > 0 ? between : replaceCipsInText(between));
    out.push(m[0]);
    const tagName = m[1].toLowerCase();
    const isClosing = m[0].startsWith('</');
    if (tagName === 'a') {
      anchorDepth += isClosing ? -1 : 1;
      if (anchorDepth < 0) anchorDepth = 0;
    }
    last = m.index + m[0].length;
  }
  const tail = text.slice(last);
  out.push(anchorDepth > 0 ? tail : replaceCipsInText(tail));
  return out.join('');
}

function replaceCipsMarkdown(segment: string): string {
  return segment.replace(CIP_PATTERN, (_, num) => {
    const padded = String(num).padStart(4, '0');
    return `[CIP-${padded}](/cips/${padded})`;
  });
}

// Spans we must NOT touch: fenced code, images, existing markdown links
// (their text AND url), inline code, and bare URLs. Autolinking a CIP mention
// inside any of these corrupts the markdown - e.g. a link like
// [CIP-0096](https://github.com/.../cip-0096.md) would get a nested
// [CIP-0096](/cips/0096) injected into both the label and the url.
const MD_PROTECT = /(```[\s\S]*?```|!?\[[^\]]*\]\([^)]*\)|`[^`]+`|https?:\/\/[^\s)]+)/g;

/**
 * Markdown-safe variant that emits [CIP-NNNN](/cips/NNNN) so the
 * renderer downstream produces the link tag itself. Only plain-text CIP
 * mentions are linked; mentions inside existing links / code / URLs are left
 * exactly as-is so we never break already-formatted markdown.
 */
export function autolinkCipsMarkdown(text: string): string {
  if (!text) return text;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(MD_PROTECT.source, 'g');
  while ((m = re.exec(text)) !== null) {
    out += replaceCipsMarkdown(text.slice(last, m.index)); // plain text before
    out += m[0];                                           // protected span, untouched
    last = m.index + m[0].length;
  }
  out += replaceCipsMarkdown(text.slice(last));
  return out;
}

/**
 * Extract a deduplicated set of CIP numbers referenced anywhere in the
 * text. Useful for building 'related CIPs' panels or backlink graphs.
 */
export function extractCipReferences(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  // Fresh RegExp because /g flag is stateful when reused across calls.
  const re = new RegExp(CIP_PATTERN.source, 'gi');
  while ((m = re.exec(text)) !== null) {
    seen.add(String(m[1]).padStart(4, '0'));
  }
  return Array.from(seen).sort();
}
