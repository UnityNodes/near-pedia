import './design.css';
import { getDb } from '@/lib/db';
import { getOnchainSnapshot, getValidatorStats, formatBytes } from '@/lib/onchain';
import { pageMetadata } from '@/lib/seo';
import { breadcrumbList, collectionPage } from '@/lib/jsonld';
import { statusTone } from '@/lib/status';
import { JsonLd } from '@/components/json-ld';
import { EmptyAnimation } from '@/components/resources-empty-animation';
import { PageShell, PgFoot, PgList, PgRow } from '@/components/page-shell';
import { RadarRow, SectionHead, type RadarLevel } from '@/components/monitor-parts';

export const revalidate = 300;

export const metadata = pageMetadata({
  title: 'Validators',
  description: 'Operational hub for YourChain validators: critical alerts, upgrade schedule, validator roster, governance proposals.',
  path: '/validators',
});

const ROSTER_SIZE = 24;
const PLACEHOLDER = '-';

interface RadarItem {
  id: number;
  level: RadarLevel;
  title: string;
  body: string | null;
  source_url: string | null;
  published_at: string;
  deadline: string | null;
}

interface ProposalRow {
  id: string;
  number: number;
  title: string;
  state: string;
  board_status: string | null;
  created_at: string;
}

interface ReleaseRow {
  id: string;
  repo: string;
  tag: string;
  name: string | null;
  published_at: string | null;
  url: string;
}

function getValidatorData() {
  const db = getDb();
  const safe = <T,>(fn: () => T, fallback: T): T => {
    try { return fn(); } catch { return fallback; }
  };

  const radarCritical = safe(() => db.prepare(`
    SELECT id, level, title, body, source_url, published_at, deadline
    FROM radar_items
    WHERE level IN ('critical', 'important')
      AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY level = 'critical' DESC, published_at DESC
    LIMIT 12
  `).all() as RadarItem[], []);

  const proposals = safe(() => db.prepare(`
    SELECT id, number, title, state, board_status, created_at
    FROM github_items
    WHERE repo LIKE 'your-org/%'
      AND state = 'open'
      AND (labels LIKE '%validator%' OR labels LIKE '%infrastructure%' OR title LIKE '%validator%' OR title LIKE '%node operator%')
    ORDER BY created_at DESC
    LIMIT 8
  `).all() as ProposalRow[], []);

  const recentReleases = safe(() => db.prepare(`
    SELECT id, repo, tag, name, published_at, url
    FROM github_releases
    WHERE (repo LIKE '%yourchain%' OR repo LIKE '%yoursdk%')
    ORDER BY published_at DESC
    LIMIT 10
  `).all() as ReleaseRow[], []);

  return { radarCritical, proposals, recentReleases };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatCount(n: number | null | undefined): string {
  return n ? n.toLocaleString('en-US') : PLACEHOLDER;
}

export default async function ValidatorsPage() {
  const { radarCritical, proposals, recentReleases } = getValidatorData();
  const [net, vals] = await Promise.all([getOnchainSnapshot(), getValidatorStats()]);
  const validators = vals.rows;
  const roster = validators.slice(0, ROSTER_SIZE);
  const activeTotal = vals.active > 0 ? vals.active : validators.length;

  const schemas = [
    collectionPage({
      name: 'YOURPEDIA for Validators',
      description: 'Operational hub for YourChain validators: alerts, upgrades, validator roster, governance proposals, latest releases.',
      path: '/validators',
      itemCount: vals.active,
    }),
    breadcrumbList([
      { name: 'Home', path: '/' },
      { name: 'Validators', path: '/validators' },
    ]),
  ];

  const kpis: Array<[string, string]> = net.chain ? [
    ['Block Height', net.chain.height?.toLocaleString('en-US') ?? PLACEHOLDER],
    ['Active Validators', formatCount(vals.active)],
    ['Registered', vals.registered ? vals.registered.toLocaleString('en-US') : (net.chain.totalValidators?.toLocaleString('en-US') ?? PLACEHOLDER)],
    ['TKN Supply', net.chain.totalSupplyTkn ? Math.round(net.chain.totalSupplyTkn).toLocaleString('en-US') : PLACEHOLDER],
    ['Data Stored', formatBytes(net.chain.totalDataSizeBytes)],
    ['Transactions', net.chain.totalTx?.toLocaleString('en-US') ?? PLACEHOLDER],
    ['TKN Price', net.market?.priceUsd != null ? `$${net.market.priceUsd.toFixed(2)}` : PLACEHOLDER],
  ] : [];

  const hasContent = radarCritical.length > 0 || kpis.length > 0 || roster.length > 0 || proposals.length > 0 || recentReleases.length > 0;

  return (
    <PageShell
      href="/validators"
      title="Validators"
      description="Operational hub for YourChain validators: upgrade alerts, validator roster, infrastructure proposals, latest release tags."
      stat={activeTotal > 0 ? { value: activeTotal, unit: activeTotal === 1 ? 'active validator' : 'active validators' } : undefined}
      synced={net.chain ? net.fetchedAt : null}
      source="Explorer indexer"
    >
      <JsonLd payload={schemas} />

      {!hasContent && (
        <PgList>
          <div className="pg-empty">
            <EmptyAnimation />
            <p>No validator data held yet. Alerts, the roster and network state appear here once the radar refresh and the Explorer indexer have run.</p>
          </div>
        </PgList>
      )}

      <div className="mn-stack">
        {radarCritical.length > 0 && (
          <section aria-labelledby="vl-alerts">
            <SectionHead id="vl-alerts" label="Active alerts" count={radarCritical.length} tone="bad" />
            <PgList>
              {radarCritical.map((r, i) => (
                <RadarRow
                  key={r.id}
                  level={r.level}
                  title={r.title}
                  href={r.source_url}
                  deadline={r.deadline}
                  published={r.published_at}
                  index={i}
                />
              ))}
            </PgList>
          </section>
        )}

        {net.chain && (
          <section aria-labelledby="vl-network">
            <SectionHead id="vl-network" label="Network state" tone="ok" />
            <div className="vl-kpis">
              {kpis.map(([label, value], i) => (
                <div key={label} className="vl-kpi" style={{ animationDelay: `${i * 40}ms` }}>
                  <b>{value}</b>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <p className="vl-note">via Explorer + CoinGecko · {net.fetchedAt.slice(0, 16).replace('T', ' ')} UTC</p>
          </section>
        )}

        {roster.length > 0 && (
          <section aria-labelledby="vl-roster">
            <SectionHead id="vl-roster" label="Validators by voting power" count={roster.length} tone="lime" />
            <PgList>
              <div className="vl-scroll">
                <table className="vl-table">
                  <caption className="pg-sr">Active validators ranked by voting power</caption>
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Validator</th>
                      <th scope="col" className="vl-num">Voting power</th>
                      <th scope="col" className="vl-num">Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((v, i) => (
                      <tr key={v.valoperAddress ?? v.moniker}>
                        <td className="vl-rank">{i + 1}</td>
                        <td className="vl-name">
                          {v.website ? (
                            <a href={v.website} target="_blank" rel="noopener noreferrer">
                              {v.moniker}
                              <span className="vl-ext" aria-hidden="true">↗</span>
                              <span className="pg-sr"> (opens in a new tab)</span>
                            </a>
                          ) : v.moniker}
                        </td>
                        <td className="vl-num">{v.votingPower != null ? `${Math.round(v.votingPower).toLocaleString('en-US')} TKN` : PLACEHOLDER}</td>
                        <td className="vl-num">{v.commissionRate != null ? `${(v.commissionRate * 100).toFixed(0)}%` : PLACEHOLDER}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PgList>
            <div className="vl-foot">
              <PgFoot shown={roster.length} total={activeTotal}>
                {vals.jailed ? <span>{vals.jailed.toLocaleString('en-US')} jailed</span> : undefined}
              </PgFoot>
            </div>
          </section>
        )}

        {proposals.length > 0 && (
          <section aria-labelledby="vl-proposals">
            <SectionHead id="vl-proposals" label="Validator + infrastructure proposals" count={proposals.length} tone="info" />
            <PgList>
              {proposals.map((p, i) => {
                const status = p.board_status ?? p.state;
                return (
                  <PgRow
                    key={p.id}
                    href={`/proposals/${p.id.replace('#', '/')}`}
                    tag={status}
                    tone={statusTone(capitalize(status))}
                    meta={`#${p.number}`}
                    title={p.title}
                    date={p.created_at.slice(0, 10)}
                    delay={i * 40}
                  />
                );
              })}
            </PgList>
          </section>
        )}

        {recentReleases.length > 0 && (
          <section aria-labelledby="vl-releases">
            <SectionHead id="vl-releases" label="Recent releases" count={recentReleases.length} tone="ok" />
            <PgList>
              {recentReleases.map((r, i) => (
                <PgRow
                  key={r.id}
                  href={r.url}
                  external
                  tag={r.repo}
                  title={r.name ?? r.tag}
                  date={r.published_at?.slice(0, 10)}
                  delay={i * 40}
                />
              ))}
            </PgList>
          </section>
        )}
      </div>
    </PageShell>
  );
}
