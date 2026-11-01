import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENV ?? process.env.NODE_ENV ?? 'production',
  tracesSampleRate: 0.1,
  // Quiet during local dev / DB-free tests.
  enabled: process.env.NODE_ENV === 'production' && !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Keep the bundle small — opt out of performance + replay extras
  // we're not using yet.
  integrations: [],
  // Drop benign client-abort errors: a client closing the tab mid-response
  // fails on a closed socket. These events are noise, not bugs.
  ignoreErrors: [
    /failed to pipe response/i,
    /ECONNRESET/,
    /socket hang up/i,
    /ERR_HTTP_REQUEST_TIMEOUT/,
    /aborted/i,
  ],
});
