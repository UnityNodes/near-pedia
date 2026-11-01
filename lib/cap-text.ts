/**
 * A length cap that admits to itself.
 *
 * No sync in this app currently
 * truncates a body column with a bare `.slice(0, N)` at the time of writing
 * (checked: every `.slice()` on a text field here is a genuinely short,
 * deliberate excerpt/description, not a body cap) - this exists so the next
 * one that does has a marked cut instead of a silent one, and
 * scripts/check-corpus-text.ts can tell the two apart across the corpus.
 */

/**
 * The sentence appended when a cap bites. Searched for by
 * scripts/check-corpus-text.ts, so it must stay one literal string.
 */
import { SITE } from './site.config';

export const TRUNCATION_MARKER = `[${SITE.name}: text truncated at storage limit; the source document continues]`;

/**
 * Cut `text` to at most `max` characters, marking the cut when it happens.
 *
 * Cuts on a whitespace boundary when one is near the limit, because a
 * half-token reads as a real identifier to whoever gets it next.
 */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text;

  const room = max - TRUNCATION_MARKER.length - 2;
  if (room <= 0) return TRUNCATION_MARKER;

  let cut = text.slice(0, room);
  // Only back up to a space if one is reasonably close, or a document with no
  // whitespace in its last 500 characters would lose far more than the cap asks.
  const lastBreak = cut.search(/\s\S*$/);
  if (lastBreak > room - 500) cut = cut.slice(0, lastBreak);

  return `${cut.trimEnd()}\n\n${TRUNCATION_MARKER}`;
}
