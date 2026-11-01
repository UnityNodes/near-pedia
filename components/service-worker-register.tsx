'use client';

import { useEffect } from 'react';

/**
 * Registers /sw.js once on mount. Auto-prompts the new SW to activate
 * via SKIP_WAITING when an update lands (keeps the second-tab gotcha
 * of the default 'waiting' state out of users' way).
 *
 * Disabled in development by default (Service Workers + Next.js HMR
 * fight each other). Set NEXT_PUBLIC_SW=1 to opt in locally.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    const enabled =
      process.env.NODE_ENV === 'production' ||
      process.env.NEXT_PUBLIC_SW === '1';
    if (!enabled) return;

    let cancelled = false;

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        if (cancelled) return;

        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              installing.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      } catch (err) {
        // SW failures are non-fatal - the app still works without offline.
        // eslint-disable-next-line no-console
        console.warn('[SW] register failed:', err instanceof Error ? err.message : err);
      }
    };

    register();
    return () => { cancelled = true; };
  }, []);

  return null;
}
