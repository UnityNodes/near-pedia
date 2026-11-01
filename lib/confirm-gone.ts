/**
 * Asking upstream whether a row is gone, instead of guessing from a ratio.
 *
 * THE CLASS. `prune()` refuses a deletion over 25% of a source because a blip
 * looks exactly like "upstream deleted everything". It has two cases and the
 * world has three: upstream is broken, upstream removed the page, and upstream
 * RENAMED it. A rename presents as a large deletion, so the guard refuses, and
 * the old rows keep answering as current.
 *
 * That is not hypothetical. This has happened: a doc host renamed a
 * quarter of its reference pages, the guard read that as a possible outage
 * and refused for eight days straight, and the renamed-away pages kept
 * answering as current with the live copy ranked below them in search.
 *
 * THE FIX IS TO ANSWER THE QUESTION, NOT LOOSEN THE THRESHOLD. For a
 * URL-keyed source "is this really gone?" is checkable. Raising
 * maxDeleteRatio would discard the guard for every future run instead,
 * including the run where upstream really is down.
 *
 * `lib/prune.ts` is deliberately NOT touched: this is a caller-side wrapper
 * over the dryRun/confirmedGone contract it already exposes.
 */

import type { PruneSpec, PruneResult } from './prune';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export interface ConfirmGoneOptions {
  /** Sent on every probe. Hosts that rate-limit unknown agents answer this one. */
  userAgent: string;
  /** Spacing between probes. Use the crawler's own delay for this host. */
  delayMs: number;
  /**
   * Above this many candidates, do not probe at all and say so.
   *
   * A deletion that large is either a real outage or a restructure worth a
   * human look, and probing hundreds of URLs is slow and rude to the host.
   * The cap is REPORTED rather than applied silently: a cap that hides what
   * it dropped is how a shrunken walk reads as a clean one.
   */
  cap?: number;
}

export interface ConfirmedPrune {
  /** Candidates the dry run named. */
  candidates: number;
  /** Of those, proven gone with a final 404/410. */
  confirmed: number;
  /** Set when the candidate list was over the cap, so nothing was probed. */
  overCap: boolean;
}

/**
 * Which of these URLs does upstream actually refuse to serve?
 *
 * ONLY A FINAL 404 OR 410 COUNTS. A timeout, a 5xx, a 403 or a bot challenge
 * are all consistent with "upstream is having a bad day", which is precisely
 * the case the ratio guard exists to survive, so an unanswered probe returns
 * nothing and the row keeps its protection.
 *
 * REDIRECTS ARE FOLLOWED and the status that counts is the one at the end. A
 * 301 onto a live landing page answers 200 and is correctly not confirmed; a
 * 301 onto a removed page answers 404 and is.
 *
 * 429 AND 503 ARE RETRIED, because otherwise this never confirms anything
 * against a host that rate-limits or bot-mitigates unknown probers.
 *
 * GET RATHER THAN HEAD: several doc hosts answer HEAD with 405 while serving
 * the page, and a 405 read as "present" makes the probe useless.
 */
export async function confirmGone(urls: readonly string[], opts: ConfirmGoneOptions): Promise<string[]> {
  const gone: string[] = [];
  for (const url of urls) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await sleep(2000 * attempt);
      let status = 0;
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 15000);
        const res = await fetch(url, { headers: { 'User-Agent': opts.userAgent }, signal: ctl.signal, redirect: 'follow' });
        clearTimeout(t);
        status = res.status;
      } catch { /* unanswered is not evidence */ }
      if (status === 429 || status === 503) continue;
      if (status === 404 || status === 410) gone.push(url);
      break;
    }
    await sleep(opts.delayMs);
  }
  return gone;
}

/**
 * The whole pattern: name the candidates, ask upstream about them, then prune.
 *
 * Takes the prune spec and the prune function rather than importing prune
 * here, so a caller with its own `clearReferences` passes it through
 * untouched.
 */
export async function pruneConfirmingUrls(
  spec: PruneSpec,
  runPrune: (s: PruneSpec) => PruneResult,
  opts: ConfirmGoneOptions,
): Promise<{ result: PruneResult; report: ConfirmedPrune }> {
  const cap = opts.cap ?? 60;
  const dry = runPrune({ ...spec, dryRun: true });
  const candidates = dry.doomedKeys.length;
  if (candidates === 0) {
    return { result: runPrune({ ...spec, confirmedGone: [] }), report: { candidates: 0, confirmed: 0, overCap: false } };
  }
  if (candidates > cap) {
    return { result: runPrune({ ...spec, confirmedGone: [] }), report: { candidates, confirmed: 0, overCap: true } };
  }
  const confirmed = await confirmGone(dry.doomedKeys, opts);
  return {
    result: runPrune({ ...spec, confirmedGone: confirmed }),
    report: { candidates, confirmed: confirmed.length, overCap: false },
  };
}
