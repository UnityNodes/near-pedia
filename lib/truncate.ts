/**
 * Cutting a body for an answer, and saying in the answer that it was cut.
 *
 * A cut with no seam hands an agent a prefix it cannot tell apart from a
 * document that simply doesn't discuss the thing it was asked about. Naming
 * the true length matters as much as the marker: it's the difference between
 * "there is more" and "you have 28% of it".
 */

/**
 * `text` if it fits, otherwise the first `limit` characters followed by a line
 * naming the cut, the true length, and where the rest lives.
 *
 * `more` should say how to get the remainder (a tool call, a URL), because a
 * caller that knows it was cut and cannot act on that is only marginally better
 * off than one that never knew.
 */
export function cutForAnswer(text: string, limit: number, more?: string): string {
  if (text.length <= limit) return text;
  const where = more ? `; ${more}` : '';
  return `${text.slice(0, limit)}\n[truncated at ${limit} of ${text.length} chars${where}]`;
}

/** The marker's fixed prefix, so a check can look for it without matching prose. */
export const TRUNCATION_MARKER = '[truncated at ';
