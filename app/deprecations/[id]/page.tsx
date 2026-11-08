import Link from 'next/link';
import { notFound } from 'next/navigation';
import '../../radar/design.css';
import '../../../components/monitor-parts.css';
import { getDb } from '@/lib/db';
import { pageMetadata } from '@/lib/seo';
import { evidenceOf, getDeprecation, liveLineFor } from '@/lib/deprecations';
import { PageShell, PgList } from '@/components/page-shell';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/deprecation-labels';
import { signalLabel } from '../signal-labels';
import { splitEffective } from '@/lib/effective-text';

export const revalidate = 300;

interface Props { params: Promise<{ id: string }> }

function load(raw: string) {
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    return null;
  }
  try {
    const db = getDb();
    const d = getDeprecation(db, id);
    return d ? { d, evidence: evidenceOf(db, d.id), live: liveLineFor(db, d.effective_protocol) } : null;
  } catch (e) {
    if (/no such table/.test((e as Error).message)) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: Props) {
  const r = load((await params).id);
  return pageMetadata({
    title: r ? `${r.d.title}: ${STATUS_LABEL[r.d.status].toLowerCase()}` : 'Deprecation',
    description: r ? r.d.summary.slice(0, 200) : 'A NEAR deprecation entry with its evidence.',
    path: `/deprecations/${(await params).id}`,
  });
}

export default async function DeprecationPage({ params }: Props) {
  const r = load((await params).id);
  if (!r) notFound();
  const { d, evidence, live } = r;
  const effective = splitEffective(d.effective);
  return (
    <PageShell
      href="/deprecations"
      kicker={`${STATUS_LABEL[d.status].toUpperCase()} · ${d.kind.replace('_', ' ').toUpperCase()}`}
      title={d.title}
      description={d.summary}
      synced={d.built_at}
      source={d.origin === 'seed' ? 'curated, re-checked on every build' : `${d.strength} signal`}
    >
      <div className="mn-stack">
        <section>
          <div className="pg-row mn-row--static">
            <div className="pg-row-main">
              <div className="pg-row-top">
                <span className="pg-tag" data-tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</span>
                {d.since && <span className="pg-tag">since {d.since.slice(0, 10)}</span>}
                {effective && <span className="pg-tag" data-tone="lime">effective {effective.chip}</span>}
                {d.stale && <span className="pg-tag" data-tone="mute">evidence stale</span>}
                {d.contested && <span className="pg-tag" data-tone="info">contested</span>}
              </div>
              {d.replacement && (
                <div className="pg-row-title">
                  Use instead:{' '}
                  {d.replacement_url ? <a href={d.replacement_url} target="_blank" rel="noopener noreferrer">{d.replacement}</a> : d.replacement}
                </div>
              )}
              {effective?.note && <div className="pg-row-sub">{effective.note}</div>}
              {live && <div className="pg-row-sub">{live}</div>}
            </div>
          </div>
        </section>

        <section aria-labelledby="ev">
          <h2 id="ev" className="dp-h2" style={{ fontSize: '1.05rem', margin: '1.25rem 0 .5rem' }}>Evidence</h2>
          <PgList empty={evidence.length === 0 ? <div className="pg-empty">No evidence is recorded for this entry.</div> : undefined}>
            {evidence.map((e, i) => (
              <a key={i} href={e.source_url} className="pg-row" target="_blank" rel="noopener noreferrer">
                <div className="pg-row-main">
                  <div className="pg-row-top">
                    <span className="pg-tag" data-tone={e.supports ? (e.strength === 'strong' ? 'bad' : 'info') : 'ok'}>{e.supports ? '' : 'Against: '}{signalLabel(e.signal)}</span>
                    <span className="pg-tag">{e.strength}</span>
                    {e.verified === true && <span className="pg-tag" data-tone="ok">confirmed in synced data</span>}
                    {e.verified === false && <span className="pg-tag" data-tone="bad">quote no longer at source</span>}
                    {e.checked && <span className="pg-tag">{e.expired ? `hand check of ${e.checked} expired` : `checked by hand ${e.checked}`}</span>}
                  </div>
                  {e.quote && <div className="pg-row-title" style={{ overflowWrap: 'anywhere' }}>&ldquo;{e.quote}&rdquo;</div>}
                  <div className="pg-row-sub">{e.source_url}<span className="pg-sr"> (opens in a new tab)</span></div>
                </div>
                <div className="pg-row-end">
                  {e.upstream_date && <span className="pg-row-date">{e.upstream_date.slice(0, 10)}</span>}
                  <span className="pg-row-go" aria-hidden="true">↗</span>
                </div>
              </a>
            ))}
          </PgList>
        </section>

        <p className="pg-row-sub">
          Agents get this entry from <code>check_deprecation(&quot;{d.id}&quot;)</code> and <code>GET /api/v1/deprecations/{d.id}</code>; <code>check_code</code> flags code that uses it. <Link href="/deprecations">All deprecations →</Link>
        </p>
      </div>
    </PageShell>
  );
}
