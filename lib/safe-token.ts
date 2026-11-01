import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time secret comparison.
 *
 * Avoids leaking a token through response timing: `===` on strings stops at
 * the first differing byte, so an attacker who can measure the difference
 * learns the secret one character at a time. The length pre-check is required,
 * because timingSafeEqual throws on unequal lengths; a token's length is not
 * meaningfully secret.
 *
 * It lived in lib/admin-bruteforce.ts, which went with the admin surface. The
 * one remaining caller, /api/metrics, was comparing with ===, which is what the
 * deletion surfaced.
 */
export function safeTokenEqual(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
