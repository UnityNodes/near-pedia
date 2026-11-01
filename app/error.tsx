'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import '@/app/reader.css';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error to whatever monitoring we wire up later (Sentry / etc).
    // For now keep it in console so server logs catch it in prod.
    console.error('[app-error-boundary]', error);
  }, [error]);

  return (
    <div className="rd-state">
      <div className="rd-state-in">
        <div className="rd-state-k">ERROR / 500</div>
        <h1>Something went wrong</h1>
        <p>An unexpected error occurred. We&apos;re looking into it.</p>
        {error.digest && <p className="rd-state-id">Error ID: {error.digest}</p>}
        <div className="rd-actions">
          <button type="button" onClick={reset} className="pg-btn">
            <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />Try again
          </button>
          <Link href="/" className="pg-btn pg-btn--line">
            <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />Home
          </Link>
        </div>
      </div>
    </div>
  );
}
