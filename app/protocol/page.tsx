import Link from 'next/link';
import '../radar/design.css';
import '../../components/monitor-parts.css';
import { getDb } from '@/lib/db';
import { pageMetadata } from '@/lib/seo';
import { protocolReport, STALE_SNAPSHOT_S, type ProtocolReport } from '@/lib/protocol';
import { PageShell, PgList } from '@/components/page-shell';

export const revalidate = 120;

export const metadata = pageMetadata({
  title: 'NEAR protocol status',
  description: 'NEAR mainnet and testnet protocol versions, the block producers\' upgrade vote by stake, epoch progress and the upgrade schedule from the latest nearcore release.',
  path: '/protocol',
});

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function eta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '';
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `about ${h} h ${m} min` : `about ${m} min`;
}

/** Only a table that does not exist yet means "not synced"; any other failure is an error, not a cached empty page. */
function load(): ProtocolReport | null {
  try {
    return protocolReport(getDb(), ['mainnet', 'testnet']);
  } catch (e) {
    if (/no such table/.test((e as Error).message)) return null;
    throw e;
  }
}

export default function ProtocolPage() {
  const r = load();
  const observed = r?.networks.map((n) => n.snapshot.observed_at).sort().pop() ?? null;
  return (
    <PageShell
      href="/protocol"
      title="Protocol"
      description={<>Read from NEAR RPC every 15 minutes: the version each network runs, what its block producers vote for and with how much stake, and when the nearcore release notes schedule the vote. A version takes effect two epochs after it passes the threshold. Agents get this from <code>get_protocol_status</code>.</>}
      synced={observed}
      source="sync-protocol"
    >
      {!r || r.networks.length === 0 ? (
        <PgList><div className="pg-empty">The protocol sync has not run on this server yet.</div></PgList>
      ) : (
        <div className="mn-stack">
          {r.networks.map((n) => {
            const s = n.snapshot;
            const upgrading = s.latest_protocol_version > s.protocol_version || n.pending_steps.length > 0 || n.passing !== null;
            const stale = n.age_s > STALE_SNAPSHOT_S;
            return (
              <section key={s.network} aria-labelledby={`pr-${s.network}`}>
                <h2 id={`pr-${s.network}`} className="dp-h2" style={{ fontSize: '1.1rem', margin: '1rem 0 .5rem', textTransform: 'capitalize' }}>{s.network}</h2>
                <div className="pg-list">
                  <div className="pg-row mn-row--static">
                    <div className="pg-row-main">
                      <div className="pg-row-top">
                        <span className="pg-tag" data-tone={upgrading ? 'lime' : 'ok'}>{upgrading ? 'Upgrade under way' : 'Up to date'}</span>
                        {s.node_version && <span className="pg-tag">nearcore {s.node_version}</span>}
                        {stale && <span className="pg-tag" data-tone="bad">snapshot {Math.round(n.age_s / 3600)} h old</span>}
                      </div>
                      <div className="pg-row-title">
                        Protocol {s.protocol_version}{s.latest_protocol_version > s.protocol_version ? ` · the RPC node we read runs software for ${s.latest_protocol_version}` : ''}
                      </div>
                      <div className="pg-row-sub">
                        Epoch {s.epoch_height ?? '?'}{n.epoch_progress !== null ? `, ${pct(n.epoch_progress)} through` : ''}{n.seconds_left !== null ? `, ends in ${eta(n.seconds_left)}` : ''} · block {s.block_height.toLocaleString('en-US')} · {n.block_rate.toFixed(2)} blocks/s
                      </div>
                    </div>
                  </div>

                  <div className="pg-row mn-row--static">
                    <div className="pg-row-main">
                      <div className="pg-row-top"><span className="pg-tag">Block-producer vote this epoch</span><span className="pg-row-meta">{n.tally.producers_seen} of {n.tally.producers} producers seen, {pct(n.tally.coverage)} of stake</span></div>
                      {n.tally.shares.map((v) => (
                        <div key={v.version} className="pg-row-sub" style={{ display: 'grid', gridTemplateColumns: '7rem 1fr 4.5rem', gap: '.6rem', alignItems: 'center', margin: '.3rem 0' }}>
                          <span>version {v.version}</span>
                          <span aria-hidden="true" style={{ height: '.5rem', borderRadius: '.25rem', background: 'var(--bg-2)', position: 'relative', overflow: 'hidden' }}>
                            <span style={{ position: 'absolute', inset: 0, width: `${Math.min(100, v.share * 100)}%`, background: v.version > s.protocol_version ? 'var(--accent-text)' : 'var(--cy, #888)' }} />
                            {n.threshold !== null && <span style={{ position: 'absolute', top: 0, bottom: 0, left: `${n.threshold * 100}%`, width: '2px', background: 'var(--bad)' }} title={`threshold ${pct(n.threshold)}`} />}
                          </span>
                          <span>{pct(v.share)}</span>
                        </div>
                      ))}
                      <div className="pg-row-sub">
                        {n.threshold !== null ? `A version needs more than ${pct(n.threshold)} of stake (the marked line on each bar).` : ''}{' '}
                        {n.passing !== null ? `Protocol ${n.passing} has passed it and takes effect two epochs on.` : 'No version above the current one has passed it this epoch.'}
                      </div>
                    </div>
                  </div>

                  {n.pending_steps.length > 0 && r.schedule && (
                    <a className="pg-row" href={r.schedule.release_url} target="_blank" rel="noopener noreferrer">
                      <div className="pg-row-main">
                        <div className="pg-row-top"><span className="pg-tag" data-tone="lime">Schedule</span><span className="pg-row-meta">nearcore {r.schedule.release}</span></div>
                        {n.pending_steps.map((st) => (
                          <div key={st.version} className="pg-row-title">Voting for {st.version} starts {st.starts_at.slice(0, 16).replace('T', ' ')} UTC</div>
                        ))}
                        {r.schedule.after_vote && <div className="pg-row-sub">{r.schedule.after_vote}</div>}
                      </div>
                      <div className="pg-row-end"><span className="pg-row-go" aria-hidden="true">↗</span></div>
                    </a>
                  )}

                  {n.waiting.length > 0 && (
                    <div className="pg-row mn-row--static">
                      <div className="pg-row-main">
                        <div className="pg-row-top"><span className="pg-tag" data-tone="bad">Changes waiting on the upgrade</span></div>
                        {n.waiting.map((w) => (
                          <div key={w.id} className="pg-row-sub">
                            <Link href={`/deprecations/${encodeURIComponent(w.id)}`}>{w.title}</Link>, from protocol {w.effective_protocol}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
