'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const STORAGE_KEY = 'nearpedia-cookie-notice-ack';

/**
 * Non-blocking cookie notice.
 *
 * We only use strictly-necessary cookies, so a hard
 * consent gate is not legally required under ePrivacy. But a small dismissible
 * notice is good practice and makes the data-collection posture explicit.
 *
 * Persists dismissal in localStorage so users see it only once.
 */
export function CookieNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      // localStorage blocked (e.g. private mode with strict settings) -> don't show notice
    }
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // ignore - at worst the notice shows again next visit
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div role="region" aria-label="Cookie notice" className="cookie-notice">
      <div className="cookie-notice-text">
        We use only <strong>strictly-necessary cookies</strong>. No tracking, no analytics cookies.{' '}
        <Link href="/privacy">Learn more</Link>
      </div>
      <button type="button" onClick={dismiss} className="pg-btn cookie-notice-btn" aria-label="Dismiss cookie notice">
        OK
      </button>
    </div>
  );
}
