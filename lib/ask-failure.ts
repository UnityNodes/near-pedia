import { BusyError, UnverifiedAnswerError } from './near-ai';
import type { FailureKind } from './failure-events';

const DETAIL_MAX = 300;
const CAUSE_DEPTH = 5;
const KEY_OR_CREDITS = new Set([401, 402]);

export interface AskFailure {
  status: 502 | 503;
  body: { error: string; detail?: string };
  record: { kind: FailureKind; detail: string } | null;
}

function statusOf(e: unknown): number | null {
  if (!e || typeof e !== 'object') return null;
  const { status, failure } = e as { status?: unknown; failure?: { details?: { status?: unknown } } };
  if (typeof status === 'number') return status;
  const nested = failure?.details?.status;
  return typeof nested === 'number' ? nested : null;
}

export function providerStatus(e: unknown): number | null {
  let cur: unknown = e;
  for (let depth = 0; depth < CAUSE_DEPTH && cur; depth++) {
    const s = statusOf(cur);
    if (s !== null) return s;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

export function providerNote(status: number | null): string | null {
  if (status === null) return null;
  if (KEY_OR_CREDITS.has(status)) return `NEAR AI refused the request (HTTP ${status}): key or credits`;
  return `NEAR AI returned HTTP ${status}`;
}

export function askFailure(e: unknown): AskFailure {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof BusyError) return { status: 503, body: { error: msg }, record: null };
  if (e instanceof UnverifiedAnswerError) {
    const detail = msg.slice(0, DETAIL_MAX);
    return { status: 502, body: { error: 'NEAR AI answered, but the response signature did not verify; no answer is shown', detail }, record: { kind: 'degraded', detail } };
  }
  const note = providerNote(providerStatus(e));
  const detail = (note ? `${note}; ${msg}` : msg).slice(0, DETAIL_MAX);
  return { status: 502, body: { error: 'NEAR AI did not answer this time. Try again in a moment.', detail }, record: { kind: 'failed', detail } };
}
