import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft, Search } from 'lucide-react';
import '@/app/reader.css';

export const metadata: Metadata = {
  title: '404, Page not found',
  description: 'The page you were looking for does not exist.',
};

export default function NotFound() {
  return (
    <div className="rd-state">
      <div className="rd-state-in">
        <div className="rd-state-k">ERROR / 404</div>
        <h1>Page not found</h1>
        <p>
          The page you were looking for doesn&apos;t exist. It may have been moved, renamed, or never existed.
        </p>
        <div className="rd-actions">
          <Link href="/" className="pg-btn">
            <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />Back to home
          </Link>
          <Link href="/search" className="pg-btn pg-btn--line">
            Search instead<Search size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}
