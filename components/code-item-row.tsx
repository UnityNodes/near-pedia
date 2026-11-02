import type { CodeItem } from '@/lib/code';
import { formatDate } from '@/lib/utils';
import { statusTone } from '@/lib/status';
import { PgRow } from '@/components/page-shell';

const REPO_LABEL: Record<string, string> = {
  'near/nearcore':       'nearcore',
  'near/near-sdk-rs':    'near-sdk-rs',
  'near/near-api-js':    'near-api-js',
  'near/mpc':            'Chain Signatures (mpc)',
  'near/NEPs':           'NEPs',
  'near/docs':           'docs.near.org',
  'nearai/ironclaw':     'IronClaw',
  'Near-One/omni-bridge': 'Omni Bridge',
  'defuse-protocol/sdk-monorepo': 'Intents SDK',
};

export { REPO_LABEL };

const MAX_LABELS = 3;

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function CodeItemRow({ item, delay = 0 }: { item: CodeItem; delay?: number }) {
  const labels = item.labels ? item.labels.split(',').map(l => l.trim()).filter(Boolean) : [];
  const isPR = item.type === 'pr' || item.url?.includes('/pull/');
  const kind = isPR ? 'PR' : 'Issue';
  const repo = REPO_LABEL[item.repo] ?? item.repo;

  return (
    <PgRow
      href={item.url}
      external
      tag={item.state}
      tone={statusTone(capitalize(item.state))}
      meta={`${kind} #${item.number} · ${repo} · ${item.author ?? 'unknown'}`}
      title={item.title}
      sub={labels.length > 0 ? (
        <span className="cde-labels">
          {labels.slice(0, MAX_LABELS).map(lab => <span key={lab} className="cde-label">{lab}</span>)}
        </span>
      ) : undefined}
      date={formatDate(item.created_at)}
      delay={delay}
    />
  );
}
