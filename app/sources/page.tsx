import type { Metadata } from 'next';
import Link from 'next/link';
import './design.css';
import { SourcesLive } from '@/components/sources-live';
import { PageShell, PgFoot, PgList } from '@/components/page-shell';
import { SectionHead } from '@/components/monitor-parts';
import { getSourceInventory } from '@/lib/sources';
import { scheduleFromTick } from '@/lib/schedule';
import { freshnessRows, latestSync, ragChunkCount, renderClock } from './freshness';
import { SyncAge } from './sync-age';

export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const { source_count, mcp_tools_count } = await getSourceInventory();
  return {
    title: 'Sources',
    description: `${source_count} live YourChain knowledge sources indexed by YOURPEDIA, semantically searchable via ${mcp_tools_count} MCP tools. Real-time data.`,
    alternates: { canonical: 'https://yourpedia.example/sources' },
    openGraph: {
      title: `YOURPEDIA · ${source_count} live YourChain knowledge sources`,
      description:
        'Forum, docs, CIPs, GitHub, YouTube, ecosystem projects and more - all indexed, all searchable, all current.',
      url: 'https://yourpedia.example/sources',
    },
  };
}

function loadSchedule(): ReadonlyMap<string, { bucket: string }> {
  try {
    return scheduleFromTick();
  } catch {
    return new Map();
  }
}

export default async function SourcesPage() {
  const summary = await getSourceInventory();
  const rows = freshnessRows(summary.sources, loadSchedule());
  const chunks = ragChunkCount(summary.sources);
  const serverNow = renderClock();

  return (
    <PageShell
      href="/sources"
      title="Sources"
      description={
        <>
          {summary.source_count} sources. One unified corpus. Every YourChain knowledge source you would search
          separately, indexed continuously
          {summary.mcp_tools_count > 0 && <> and exposed through {summary.mcp_tools_count} MCP tools</>}. The numbers
          below refresh every minute, straight from the production database.
        </>
      }
      stat={{ value: summary.source_count, unit: summary.source_count === 1 ? 'source' : 'sources' }}
      synced={latestSync(summary.sources)}
      source="all sources"
    >
      <SourcesLive
        initial={{ ...summary, avg_latency_ms: null }}
        endpoint={
          process.env.NODE_ENV === 'production'
            ? '/api/v1/sources'
            : 'https://yourpedia.example/api/v1/sources'
        }
      />

      <section aria-labelledby="src-freshness">
        <SectionHead id="src-freshness" label="Source freshness" count={rows.length} tone="ok" />
        <PgList>
          {rows.length === 0 ? (
            <div className="pg-empty">No sources are indexed yet. The sync scripts fill this table.</div>
          ) : (
            <div className="src-scroll">
              <table className="src-table">
                <caption className="pg-sr">Records, sync cadence and time since the last sync for each indexed source</caption>
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col" className="src-num">Records</th>
                    <th scope="col">Cadence</th>
                    <th scope="col">Last sync</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.type} style={{ animationDelay: `${i * 40}ms` }}>
                      <td className="src-name">{r.href ? <Link href={r.href}>{r.name}</Link> : r.name}</td>
                      <td className="src-num">{r.records.toLocaleString('en-US')}</td>
                      <td className="src-mono">{r.cadence ? `every ${r.cadence}` : <span className="src-dash">—</span>}</td>
                      <td className="src-mono">
                        {r.lastSynced ? <SyncAge iso={r.lastSynced} serverNow={serverNow} /> : <span className="src-dash">—</span>}
                      </td>
                      <td>
                        <span className="pg-tag" data-tone={r.lastSynced ? 'ok' : undefined}>
                          {r.lastSynced ? 'synced' : 'no sync time'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PgList>
        <div className="src-foot">
          <PgFoot shown={rows.length} total={rows.length}>
            {chunks > 0 ? <span>{chunks.toLocaleString('en-US')} embedded chunks</span> : undefined}
          </PgFoot>
        </div>
      </section>

      <div className="pg-cards">
        <div className="src-info">
          <h3>How the data lands here</h3>
          <p>
            Each source is polled on its own cadence, listed in the table above. Anything changed since the last
            sync is upserted and re-embedded.
          </p>
        </div>
        <div className="src-info">
          <h3>Why one corpus matters</h3>
          <p>
            Cross-source queries (<em>“which CIP introduced this forum breakage?”</em>) only work when forum, docs,
            CIPs, GitHub and proposals share a single semantic index.
          </p>
        </div>
        <div className="src-info">
          <h3>Verify the numbers</h3>
          <p>
            The widget calls <Link href="/api/v1/sources">/api/v1/sources</Link>. Same endpoint anyone can hit - no
            caching, no embellishment.
          </p>
        </div>
      </div>
    </PageShell>
  );
}
