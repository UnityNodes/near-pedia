/**
 * Retry with a wall-clock budget rather than only an attempt count.
 *
 * The count alone is a ceiling you have to multiply out to discover, and doing
 * that multiplication is how one real ceiling turned out to be 3 attempts x 3
 * SDK retries x a 10-minute default. The budget makes the ceiling the thing you
 * set instead of the thing you derive: no new attempt begins once the deadline
 * has passed, so the number a caller writes is the answer to "how long can this
 * block", directly.
 *
 * MOVED HERE FROM lib/embeddings.ts, where it was private, when sync-forum
 * needed the same thing. Copying it would have made two implementations of one
 * idea, which is a class this repo has a check for; the embedding path still
 * calls this one.
 */

export interface RetryOptions {
  /** Waits between attempts, in order. The attempt count is this length + 1. */
  delays?: number[];
  /**
   * Should this error end the loop immediately?
   *
   * The default refuses to retry a 4xx: a bad request, a bad token or a 404 is
   * the same on the second try, and retrying only spends the budget somebody
   * else is waiting on. A network-level failure carries no status and is
   * retried, which is the case this exists for.
   */
  fatal?: (err: unknown) => boolean;
}

const defaultFatal = (err: unknown): boolean => {
  const status = (err as { status?: number })?.status;
  return status !== undefined && status >= 400 && status < 500;
};

export async function withRetry<T>(fn: () => Promise<T>, budgetMs: number, opts: RetryOptions = {}): Promise<T> {
  const delays = opts.delays ?? [500, 1500];
  const fatal = opts.fatal ?? defaultFatal;
  const deadline = Date.now() + budgetMs;
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      if (fatal(err)) throw err;
      if (attempt < delays.length) {
        // Sleeping past the deadline only delays a failure the caller is
        // already going to get, so stop here and hand back the real error.
        if (Date.now() + delays[attempt] >= deadline) break;
        await new Promise(resolve => setTimeout(resolve, delays[attempt]));
      }
    }
  }
  throw lastError;
}
