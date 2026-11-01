import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { docPageNumbers } from '@/lib/docs-browse';
import './pg-pager.css';

interface PgPagerProps {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}

export function PgPager({ page, totalPages, hrefFor }: PgPagerProps) {
  if (totalPages <= 1) return null;
  const prev = <><ChevronLeft size={14} strokeWidth={1.75} aria-hidden="true" />Prev</>;
  const next = <>Next<ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" /></>;
  return (
    <nav className="pg-pager" aria-label="Pages">
      {page > 1
        ? <Link href={hrefFor(page - 1)} className="pg-pager-btn" rel="prev">{prev}</Link>
        : <span className="pg-pager-btn" aria-disabled="true">{prev}</span>}
      {docPageNumbers(page, totalPages).map((p, i) => p === null
        ? <span key={`gap-${i}`} className="pg-pager-gap" aria-hidden="true">…</span>
        : <Link key={p} href={hrefFor(p)} className={`pg-pager-num${p === page ? ' pg-pager-num--on' : ''}`} aria-current={p === page ? 'page' : undefined}>{p}</Link>)}
      <span className="pg-pager-of">Page {page} of {totalPages}</span>
      {page < totalPages
        ? <Link href={hrefFor(page + 1)} className="pg-pager-btn" rel="next">{next}</Link>
        : <span className="pg-pager-btn" aria-disabled="true">{next}</span>}
    </nav>
  );
}
