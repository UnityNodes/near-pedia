import type { CodeItem } from '@/lib/code';
import { formatDate } from '@/lib/utils';
import { statusTone } from '@/lib/status';
import { PgRow } from '@/components/page-shell';

const REPO_LABEL: Record<string, string> = {
  'your-org/yourchain-node':     'NEAR Node',
  'your-org/yourchain-app':      'NEAR App',
  'your-org/yourchain-core':     'NEAR Core',
  'your-org/CIPs':              'CIPs',
  'your-org/docs':              'Docs',
  'your-org/yourchain-openrpc':  'OpenRPC',
  'your-org/yoursdk':               'YourSDK',
  'your-org/yourchain-app-specs': 'App Specs',
  'your-org/networks':          'Networks',
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
