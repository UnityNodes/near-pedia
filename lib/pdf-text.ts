/**
 * Detecting text whose word boundaries were lost.
 *
 * This app does not parse PDF bodies. Only the text heuristic lives here.
 *
 * gluedRuns/looksGlued are general text heuristics, not PDF-specific: any
 * source that lost its whitespace - a bad decode, a scrape that dropped
 * spacing - is worth catching, which is why scripts/check-corpus-text.ts
 * runs this over every text surface, not just ones a PDF could reach.
 */

/**
 * Runs of letters long enough that no English word explains them.
 *
 * 25 is deliberately generous: "internationalization" is 20, the longest
 * words in most corpora ("decentralization", "interoperability") are under
 * 20. Counted on letters only, so base64 blobs, hashes and contract ids -
 * long, legitimate and full of digits - do not register.
 */
export function gluedRuns(text: string, minRun = 25): number {
  return (text.match(new RegExp(`[A-Za-z]{${minRun},}`, 'g')) ?? []).length;
}

/** Run length looksGlued counts, longer than gluedRuns' own 25. */
const CORPUS_RUN = 40;

/**
 * Does this document read as text whose word boundaries were lost?
 *
 * gluedRuns alone is not enough to ask that of a corpus: a run-together
 * sentence and a long camelCase identifier look identical one run at a time.
 * They differ across the whole document - prose has spaces in it, English
 * runs about one space in six characters - so: strip the parts that are
 * legitimately dense (fenced code, inline code, URLs, HTML, dotted
 * identifier paths, hashes/base64), then ask both questions of what is left.
 */
export function looksGlued(text: string): boolean {
  const prose = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\S*[/\\]\S*/g, ' ')
    // Dotted paths: package names and class references. A pasted stack
    // trace is mostly `io.reactivex.internal.functions.Function`, which has
    // as few spaces as glued prose and is not glued at all. Each segment is
    // bounded at 24 characters so this rule does not also match glued PROSE,
    // where sentences run together and the full stops between them look
    // exactly like the dots in a package name.
    .replace(/\b[A-Za-z_$][\w$]{0,23}(?:\.[\w$]{1,24}){2,}\b/g, ' ')
    // Hashes / contract ids: as few spaces as glued prose, and not prose.
    .replace(/\b[0-9a-fA-F]{16,}\b/g, ' ')
    // Base64 must contain a digit or a base64-only character to qualify, or
    // this rule would erase a run of glued English - the very thing it
    // exists to detect.
    .replace(/\b(?=[A-Za-z0-9+/]*[\d+/])[A-Za-z0-9+/]{40,}={0,2}\b/g, ' ');

  // Too little prose left to judge: a document that is almost entirely code
  // is not a document whose words were glued.
  if (prose.replace(/\s/g, '').length < 500) return false;

  // 0.035: calibrated against known-damaged vs. known-dense populations. Kept
  // as-is rather than re-derived without a known-damaged sample here to
  // calibrate against.
  const spaceRatio = (prose.match(/ /g) ?? []).length / prose.length;
  return spaceRatio < 0.035 && gluedRuns(prose, CORPUS_RUN) >= 3;
}
