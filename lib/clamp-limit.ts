/**
 * Parse a client-supplied limit/offset query param into a safe bound.
 *
 * `parseInt(raw) || def` (the pattern this replaces) only protects against
 * falsy input (missing, '0', non-numeric). A negative value like '-1' is
 * truthy in JS, so it sailed straight through - and SQLite treats a negative
 * LIMIT as "no limit at all", turning a documented 100-row cap into the
 * entire table. Math.max(...,1) closes that; Math.min(...,max) keeps the
 * existing ceiling behavior.
 */
export function clampLimit(raw: unknown, def: number, max: number): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  const base = n || def;
  return Math.min(Math.max(base, 1), max);
}
