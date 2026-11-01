import * as Sentry from '@sentry/nextjs';

/**
 * Per Next 15+, instrumentation hook is the supported way to wire
 * server-side error tracking. Loads the matching config for the
 * runtime that Next picks (Node or Edge).
 *
 * Reads NEXT_PUBLIC_SENTRY_DSN (also visible client-side) and
 * SENTRY_ENV (defaults to NODE_ENV).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
