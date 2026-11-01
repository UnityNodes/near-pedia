import type { CipRow, StatusChange } from '@/lib/cips';
import { GitPullRequest, Paperclip } from 'lucide-react';
import { PgRow } from '@/components/page-shell';
import { cipLabel } from '@/lib/cips-browse';
import { statusTone } from '@/lib/status';
import { formatAuthor, formatDateLong } from '@/lib/utils';

export function CipCard({ cip, attachmentCount = 0, change, delay = 0 }: {
  cip: CipRow;
  attachmentCount?: number;
  change?: StatusChange;
  delay?: number;
}) {
  const numbered = Boolean(cip.cip_number);
  const author = formatAuthor(cip.author);
  const changeTitle = change ? `${change.from ?? 'New'} to ${change.to}` : undefined;
  const meta = [cipLabel(cip.cip_number, cip.pr_number ?? cip.id), cip.type ?? (numbered ? '' : 'Open pull request'), author]
    .filter(Boolean)
    .join(' · ');
  const hasSub = !numbered || Boolean(change) || attachmentCount > 0;

  return (
    <PgRow
      href={`/cips/${cip.id}`}
      tag={cip.status ?? undefined}
      tone={statusTone(cip.status)}
      meta={meta}
      title={cip.title ?? '(untitled)'}
      sub={hasSub ? (
        <span className="cp-sub">
          {!numbered ? (
            <span className="cp-sub-item">
              <GitPullRequest size={13} strokeWidth={1.75} aria-hidden="true" />Pull request
            </span>
          ) : null}
          {change ? <span className="cp-sub-item" title={changeTitle}>Status changed {formatDateLong(change.at)}</span> : null}
          {attachmentCount > 0 ? (
            <span className="cp-sub-item" title={`${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`}>
              <Paperclip size={12} strokeWidth={1.75} aria-hidden="true" />
              {attachmentCount}
              <span className="pg-sr"> attachment{attachmentCount === 1 ? '' : 's'}</span>
            </span>
          ) : null}
        </span>
      ) : undefined}
      date={formatDateLong(cip.created_date)}
      delay={delay}
    />
  );
}
