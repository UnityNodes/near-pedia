'use client';
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import './globals.css';
import './design.css';
import './reader.css';

/**
 * Catches errors that escape the per-route error.tsx boundaries.
 * Required for SDK to wire onto Next's global error handling chain.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <html lang="en" data-theme="dark">
      <body>
        <div className="rd-state rd-state--page">
          <div className="rd-state-in">
            <div className="rd-state-k">ERROR / 500</div>
            <h1>Something went wrong</h1>
            <p>The error has been logged. Try refreshing.</p>
            <div className="rd-actions">
              <button type="button" className="pg-btn" onClick={() => window.location.reload()}>Refresh</button>
              <button type="button" className="pg-btn pg-btn--line" onClick={() => window.location.assign('/')}>Home</button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
