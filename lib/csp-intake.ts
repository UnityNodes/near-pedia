/**
 * What /api/csp-report is allowed to write.
 *
 * A CSP report endpoint is an unauthenticated INSERT that anyone on the
 * internet can call, and after a deploy the loudest caller is not an attacker
 * but ordinary visitors: an ad blocker or any extension that injects a script
 * trips the policy on every page view, and each trip is a POST. The endpoint
 * had no size limit, no rate limit and no de-duplication, so one visitor with
 * a noisy extension could write a row per navigation, forever, and the
 * `csp_violations_24h` gauge Prometheus alerts on would measure that extension
 * rather than this site.
 *
 * Three limits, in the order they are cheapest to apply:
 *
 *   1. SIZE. blocked-uri may be a `data:` URI carrying the whole offending
 *      payload; original-policy is a long string we already know. Anything
 *      past MAX_BODY_BYTES is refused before it is parsed, and each stored
 *      field is truncated.
 *   2. DEDUPE. The same violation from the same page is one fact however many
 *      times a browser repeats it. First one in a window is stored, the rest
 *      are counted and dropped.
 *   3. BUDGET. A ceiling on inserts per minute, whatever they are, so a
 *      distributed flood costs a bounded number of rows.
 *
 * Dropped reports are COUNTED, not swallowed. A silent drop would leave the
 * gauge looking calm during exactly the event it exists to show, so
 * /api/metrics publishes these counters beside the violation counts.
 *
 * State is in memory, which is right for a single-instance deployment and
 * resets on restart; the counters are gauges for that reason, not counters.
 */

export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_FIELD_CHARS = 300;
export const BUDGET_WINDOW_MS = 60_000;
export const MAX_PER_WINDOW = 120;
export const DEDUPE_MS = 5 * 60_000;
/** Hard ceiling on remembered signatures, so the dedupe map cannot grow without bound. */
const MAX_SIGNATURES = 2_000;

export interface CspFields {
  document_uri: string | null;
  violated_directive: string | null;
  blocked_uri: string | null;
  source_file: string | null;
  line_number: number | null;
}

export type Verdict = 'store' | 'duplicate' | 'over-budget';

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > MAX_FIELD_CHARS ? t.slice(0, MAX_FIELD_CHARS) : t;
}

/** Coerce and truncate whatever the browser sent into the columns we keep. */
export function normaliseReport(raw: unknown): CspFields {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const line = Number(r['line-number']);
  return {
    document_uri: str(r['document-uri']),
    violated_directive: str(r['violated-directive']),
    blocked_uri: str(r['blocked-uri']),
    source_file: str(r['source-file']),
    line_number: Number.isFinite(line) && line >= 0 ? Math.trunc(line) : null,
  };
}

const seen = new Map<string, number>();
let windowStart = 0;
let windowCount = 0;
const stats = { stored: 0, duplicate: 0, overBudget: 0, oversized: 0 };

/** A violation is the same fact when the page, the rule and the blocked thing match. */
function signature(f: CspFields): string {
  return `${f.document_uri}|${f.violated_directive}|${f.blocked_uri}`;
}

export function admit(f: CspFields, now: number = Date.now()): Verdict {
  for (const [k, t] of seen) {
    if (now - t > DEDUPE_MS) seen.delete(k);
  }
  const sig = signature(f);
  const last = seen.get(sig);
  if (last !== undefined && now - last <= DEDUPE_MS) {
    stats.duplicate += 1;
    return 'duplicate';
  }

  if (now - windowStart > BUDGET_WINDOW_MS) {
    windowStart = now;
    windowCount = 0;
  }
  if (windowCount >= MAX_PER_WINDOW) {
    stats.overBudget += 1;
    return 'over-budget';
  }

  windowCount += 1;
  // Bound the map even when every report is unique: oldest-first, since
  // insertion order is what a Map iterates.
  if (seen.size >= MAX_SIGNATURES) {
    const oldest = seen.keys().next();
    if (!oldest.done) seen.delete(oldest.value);
  }
  seen.set(sig, now);
  stats.stored += 1;
  return 'store';
}

/** Counted at the door, before a body is parsed. */
export function countOversized(): void {
  stats.oversized += 1;
}

export function intakeStats(): Readonly<typeof stats> {
  return { ...stats };
}

/** Tests only: forget the window, the signatures and the counters. */
export function resetIntake(): void {
  seen.clear();
  windowStart = 0;
  windowCount = 0;
  stats.stored = 0;
  stats.duplicate = 0;
  stats.overBudget = 0;
  stats.oversized = 0;
}
