import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENV ?? 'production',
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === 'production' && !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Drop benign client-abort errors. See sentry.server.config.ts for
  // the matching list and rationale.
  ignoreErrors: [
    /failed to pipe response/i,
    /ECONNRESET/,
    /socket hang up/i,
    /ERR_HTTP_REQUEST_TIMEOUT/,
    /aborted/i,
  ],
});
