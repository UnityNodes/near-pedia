import Link from 'next/link';
import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import './list-tools.css';

const PAGER_WINDOW = 7;

export function ListSearch({
  action, query, label, placeholder, carry,
}: {
  action: string;
  query?: string;
  label: string;
  placeholder: string;
  carry?: Record<string, string | undefined>;
}) {
  const hidden = Object.entries(carry ?? {}).filter((entry): entry is [string, string] => Boolean(entry[1]));
  return (
    <form method="get" action={action} role="search" className="pg-filter">
      <Search size={16} aria-hidden="true" />
      <input type="search" name="q" defaultValue={query ?? ''} placeholder={placeholder} aria-label={label} autoComplete="off" />
      {hidden.map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <button type="submit" className="pg-sr">Search</button>
    </form>
  );
}

export function Chip({
  href, on, count, dot, children,
}: {
  href: string;
  on: boolean;
  count?: number | string;
  dot?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`pg-chip lt-chip${on ? ' pg-chip--on' : ''}`} aria-current={on ? 'true' : undefined}>
      {dot && <span className="lt-dot" style={{ background: dot }} aria-hidden="true" />}
      {children}
      {count !== undefined && <span className="lt-count">{typeof count === 'number' ? count.toLocaleString('en-US') : count}</span>}
    </Link>
  );
}

export function ChipRow({
  ariaLabel, label, nav = false, children,
}: {
  ariaLabel: string;
  label?: string;
  nav?: boolean;
  children: ReactNode;
}) {
  const inner = (
    <>
      {label && <span className="lt-label" aria-hidden="true">{label}</span>}
      {children}
    </>
  );
  return nav ? (
    <nav className="pg-chips" aria-label={ariaLabel}>{inner}</nav>
  ) : (
    <div className="pg-chips" role="group" aria-label={ariaLabel}>{inner}</div>
  );
}

export function ListPager({
  page, totalPages, hrefFor,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}) {
  if (totalPages <= 1) return null;
  const numbers = Array.from({ length: Math.min(totalPages, PAGER_WINDOW) }, (_, i) => (page <= 4 ? i + 1 : page - 3 + i))
    .filter((p) => p >= 1 && p <= totalPages);
  return (
    <nav className="pg-chips lt-pager" aria-label="Pagination">
      {page > 1
        ? <Link href={hrefFor(page - 1)} className="pg-chip lt-chip" rel="prev">← Prev</Link>
        : <span className="pg-chip lt-chip" aria-disabled="true">← Prev</span>}
      {numbers.map((p) => (
        <Link
          key={p}
          href={hrefFor(p)}
          className={`pg-chip lt-chip${p === page ? ' pg-chip--on' : ''}`}
          aria-current={p === page ? 'page' : undefined}
        >
          {p}
        </Link>
      ))}
      {page < totalPages
        ? <Link href={hrefFor(page + 1)} className="pg-chip lt-chip" rel="next">Next →</Link>
        : <span className="pg-chip lt-chip" aria-disabled="true">Next →</span>}
    </nav>
  );
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="lt-ext">
      {children}
      <span className="pg-sr"> (opens in a new tab)</span>
    </a>
  );
}
