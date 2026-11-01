import Link from 'next/link';
import { statusTone } from '@/lib/status';

const ORDER = [
  'Early Draft', 'Draft', 'Proposed', 'In Review', 'Review', 'Active', 'Living',
  'Last Call', 'Approved', 'Implemented', 'Final', 'Stagnant', 'Withdrawn', 'Rejected',
  'Replaced', 'Obsolete', 'Superseded',
];

function rank(s: string): number {
  const i = ORDER.indexOf(s);
  return i < 0 ? ORDER.length : i;
}

export function CipStatusFacets({ counts, total, current, buildUrl }: {
  counts: { status: string; count: number }[];
  total: number;
  current?: string;
  buildUrl: (status?: string) => string;
}) {
  const sorted = [...counts].sort((a, b) => rank(a.status) - rank(b.status) || b.count - a.count);

  return (
    <div className="pg-chips" role="group" aria-label="Filter by status">
      <Link
        href={buildUrl(undefined)}
        className={`pg-chip cp-chip${!current ? ' pg-chip--on' : ''}`}
        aria-current={!current ? 'true' : undefined}
      >
        All<span className="cp-n">{total}</span>
      </Link>
      {sorted.map(s => {
        const on = current === s.status;
        return (
          <Link
            key={s.status}
            href={buildUrl(s.status)}
            className={`pg-chip cp-chip${on ? ' pg-chip--on' : ''}`}
            aria-current={on ? 'true' : undefined}
          >
            <span className="cp-dot" data-tone={statusTone(s.status)} aria-hidden="true" />
            {s.status}<span className="cp-n">{s.count}</span>
          </Link>
        );
      })}
    </div>
  );
}
