import { ArrowRight } from 'lucide-react';
import type { CipStatusHistoryRow } from '@/lib/cips';
import { formatDate } from '@/lib/utils';
import { statusTone } from '@/lib/status';

function StatusChip({ status }: { status: string | null }) {
  if (!status) return <span className="pg-tag rd-tag-new">new</span>;
  return <span className="pg-tag" data-tone={statusTone(status)}>{status}</span>;
}

export function CipStatusTimeline({ history }: { history: CipStatusHistoryRow[] }) {
  if (!history.length) {
    return <p className="rd-tl-empty">No status changes recorded.</p>;
  }

  return (
    <ol className="rd-tl">
      {history.map((row, i) => (
        <li key={row.id} data-current={i === 0 ? 'true' : undefined}>
          <span className="rd-tl-dot" data-tone={statusTone(row.to_status)} aria-hidden="true" />
          <time dateTime={row.changed_at}>{formatDate(row.changed_at)}</time>
          <div className="rd-tl-row">
            <StatusChip status={row.from_status} />
            <ArrowRight size={12} strokeWidth={1.75} aria-hidden="true" />
            <StatusChip status={row.to_status} />
          </div>
        </li>
      ))}
    </ol>
  );
}
