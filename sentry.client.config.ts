import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? 'production',
  tracesSampleRate: 0.05,
  // Disable replay/profiling — we want the lean error-only signal.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Filter MetaMask / wallet-extension chatter.
  ignoreErrors: [
    /MetaMask/,
    /Cannot redefine property: ethereum/,
    /ObjectMultiplex/,
    /chrome-extension/,
    /moz-extension/,
    /MaxListenersExceededWarning/,
  ],
});
