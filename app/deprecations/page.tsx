import Link from 'next/link';
import { Search as SearchIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import '../radar/design.css';
import '../../components/monitor-parts.css';
import { getDb } from '@/lib/db';
import { pageMetadata } from '@/lib/seo';
import { allDeprecations, findDeprecations, type DeprecationRow } from '@/lib/deprecations';
import { STATUS_RANK, type Status } from '@/lib/deprecation-types';
import type { Tone } from '@/lib/status';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/deprecation-labels';
import { PageShell, PgFoot, PgList, PgRow } from '@/components/page-shell';

export const revalidate = 300;

export const metadata = pageMetadata({
  title: 'NEAR deprecations',
  description: 'What NEAR has removed, deprecated, changed or replaced: SDKs, packages, RPC methods, protocol features and services, each with its evidence and replacement.',
  path: '/deprecations',
});

const KIND_LABEL: Record<string, string> = {
  api: 'API', config: 'Config', crate: 'Crate', package: 'Package', product: 'Product', protocol: 'Protocol',
  repo: 'Repository', rpc_method: 'RPC method', service: 'Service',
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function Chip({ href, on, label, n, tone }: { href: string; on: boolean; label: string; n: number; tone?: Tone }) {
  return (
    <Link href={href} className={`pg-chip${on ? ' pg-chip--on' : ''}`} aria-current={on ? 'page' : undefined}>
      {tone && <span className="rd-chip-dot" data-tone={tone} aria-hidden="true" />}
      {label}
      <span className="rd-chip-n">{n}</span>
    </Link>
  );
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rd-filter-row" role="group" aria-label={`Filter by ${label.toLowerCase()}`}>
      <span className="rd-filter-label" aria-hidden="true">{label}</span>
      <div className="pg-chips">{children}</div>
    </div>
  );
}

/** Curated entries and the most severe first; within that, the newest. */
function order(a: DeprecationRow, b: DeprecationRow): number {
  return Number(b.origin === 'seed') - Number(a.origin === 'seed')
    || STATUS_RANK[b.status] - STATUS_RANK[a.status]
    || (b.since ?? '').localeCompare(a.since ?? '')
    || a.title.localeCompare(b.title);
}

/** Archived repositories are most of the index (107 of 134 on 2026-11-01): shown on request, so the SDKs, APIs and protocol changes lead. */
const PAGE = 60;

export default async function DeprecationsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => ([v].flat()[0] ?? '').slice(0, 100) || undefined;
  const status = one(sp.status);
  const kind = one(sp.kind);
  const q = one(sp.q)?.trim() || undefined;
  const all = one(sp.all) === '1';
  let entries: DeprecationRow[] = [];
  let total = 0;
  let builtAt: string | null = null;
  try {
    const db = getDb();
    const index = allDeprecations(db);
    total = index.length;
    entries = q ? findDeprecations(db, q, 100) : index;
    builtAt = (db.prepare('SELECT MAX(built_at) at FROM deprecations').get() as { at: string | null }).at;
  } catch (e) {
    if (!/no such table/.test((e as Error).message)) throw e;
  }
  const everything = entries;
  const statusCounts = everything.reduce<Record<string, number>>((m, d) => ({ ...m, [d.status]: (m[d.status] ?? 0) + 1 }), {});
  const kindCounts = everything.reduce<Record<string, number>>((m, d) => ({ ...m, [d.kind]: (m[d.kind] ?? 0) + 1 }), {});
  const filtered = everything.filter((d) => (!status || d.status === status) && (!kind || d.kind === kind)).sort(order);
  const shown = all || kind === 'repo' || q ? filtered : filtered.filter((d) => d.kind !== 'repo');
  const page = shown.slice(0, all ? 500 : PAGE);

  const url = (o: { status?: string | null; kind?: string | null; all?: boolean }) => {
    const params = new URLSearchParams();
    const s = o.status !== undefined ? o.status : status;
    const k = o.kind !== undefined ? o.kind : kind;
    if (s) params.set('status', s);
    if (k) params.set('kind', k);
    if (q) params.set('q', q);
    if (o.all ?? all) params.set('all', '1');
    const qs = params.toString();
    return `/deprecations${qs ? `?${qs}` : ''}`;
  };

  return (
    <PageShell
      href="/deprecations"
      title="Deprecations"
      description={<>What NEAR has removed, deprecated, changed or replaced, from six signals: archived repositories, README notices, npm and crates.io flags, release-note removals, the docs&apos; own markers and long dormancy. Every entry links its evidence; <code>check_code</code> and <code>check_deprecation</code> answer from this list.</>}
      stat={{ value: total, unit: 'entries' }}
      synced={builtAt}
      source="build-deprecations"
    >
      <form method="get" action="/deprecations" className="dp-search pg-search" role="search">
        <SearchIcon size={18} aria-hidden="true" />
        <input name="q" defaultValue={q ?? ''} placeholder="near-sdk-js, DelegateV2, wallet-selector…" aria-label="Search deprecations" />
        <button type="submit" aria-label="Search">→</button>
      </form>
      <div className="pg-tools rd-filters">
        <ChipRow label="Status">
          <Chip href={url({ status: null })} on={!status} label="All" n={everything.length} />
          {(Object.keys(STATUS_LABEL) as Status[]).filter((s) => statusCounts[s]).map((s) => (
            <Chip key={s} href={url({ status: s })} on={status === s} label={STATUS_LABEL[s]} n={statusCounts[s]} tone={STATUS_TONE[s]} />
          ))}
        </ChipRow>
        <ChipRow label="Kind">
          <Chip href={url({ kind: null })} on={!kind} label="All" n={everything.length} />
          {Object.keys(kindCounts).sort().map((k) => (
            <Chip key={k} href={url({ kind: k })} on={kind === k} label={KIND_LABEL[k] ?? k} n={kindCounts[k]} />
          ))}
        </ChipRow>
      </div>

      <PgList empty={page.length === 0 ? <div className="pg-empty">{total ? 'Nothing matches this search or filter.' : 'The deprecation index has not been built on this server yet.'}</div> : undefined}>
        {page.map((d, i) => (
          <PgRow
            key={d.id}
            href={`/deprecations/${encodeURIComponent(d.id)}`}
            tag={STATUS_LABEL[d.status]}
            tone={STATUS_TONE[d.status]}
            meta={[KIND_LABEL[d.kind] ?? d.kind, d.origin === 'seed' ? 'checked by hand' : `${d.strength} signal`, d.stale ? 'evidence stale' : '', d.contested ? 'contested' : ''].filter(Boolean).join(' · ')}
            title={d.title}
            sub={d.replacement ? <>Use instead: {d.replacement}</> : d.summary.slice(0, 160)}
            date={d.since?.slice(0, 10)}
            delay={Math.min(i, 12) * 30}
          />
        ))}
      </PgList>

      <PgFoot shown={page.length} total={filtered.length}>
        {!all && !q && kind !== 'repo' && filtered.length > shown.length
          ? <Link href={url({ all: true })}>Include {filtered.length - shown.length} archived repositories →</Link>
          : <Link href="/for-ai">Check your code from an agent →</Link>}
      </PgFoot>
    </PageShell>
  );
}
