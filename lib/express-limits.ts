import rateLimit, { type RateLimitInfo } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import { ASK_DAILY_MAX, ASK_HOURLY_MAX } from './ask-quota';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export { ASK_DAILY_MAX, ASK_HOURLY_MAX };

function windowLabel(windowMs: number): string {
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return windowMs < HOUR_MS ? unit(windowMs / MINUTE_MS, 'minute') : unit(windowMs / HOUR_MS, 'hour');
}

export function refusal(max: number, windowMs: number) {
  return {
    statusCode: 429,
    message: { error: 'Too many requests', limit: max, window: windowLabel(windowMs), retry_after: 'See Retry-After header' },
  };
}

export function limiter(max: number, windowMs: number, requestPropertyName = 'rateLimit'): RequestHandler {
  return rateLimit({ windowMs, limit: max, standardHeaders: 'draft-6', legacyHeaders: false, requestPropertyName, ...refusal(max, windowMs) });
}

const ASK_WINDOWS = [
  { prop: 'askHour', max: ASK_HOURLY_MAX, windowMs: HOUR_MS },
  { prop: 'askDay', max: ASK_DAILY_MAX, windowMs: DAY_MS },
] as const;

export function tighter(infos: Array<{ info: RateLimitInfo; windowMs: number }>, now = Date.now()) {
  const [pick] = [...infos].sort((a, b) => a.info.remaining - b.info.remaining);
  const reset = pick.info.resetTime ? Math.max(0, Math.ceil((pick.info.resetTime.getTime() - now) / 1000)) : Math.ceil(pick.windowMs / 1000);
  return {
    'RateLimit-Policy': ASK_WINDOWS.map((w) => `${w.max};w=${w.windowMs / 1000}`).join(', '),
    'RateLimit-Limit': String(pick.info.limit),
    'RateLimit-Remaining': String(pick.info.remaining),
    'RateLimit-Reset': String(reset),
  };
}

export function askLimiters(): RequestHandler[] {
  const headers: RequestHandler = (req, res, next) => {
    const seen = ASK_WINDOWS.flatMap((w) => {
      const info = (req as Request & Record<string, RateLimitInfo | undefined>)[w.prop];
      return info ? [{ info, windowMs: w.windowMs }] : [];
    });
    if (seen.length) res.set(tighter(seen));
    next();
  };
  return [...ASK_WINDOWS.map((w) => limiter(w.max, w.windowMs, w.prop)), headers];
}
