import Link from 'next/link';
import { ArrowLeft, Network } from 'lucide-react';
import { Crumbs } from '@/components/reader-shell';
import { getCipRequiresGraph } from '@/lib/cips';
import { pageMetadata } from '@/lib/seo';

export const revalidate = 600;

export const metadata = pageMetadata({
  title: 'CIP Dependency Graph',
  description: 'Visualises the Chain Improvement Proposal dependency graph (the requires relationship) so you can see which CIPs build on which.',
  path: '/cips/graph',
});

import { STATUS_TOKENS as STATUS_COLOR } from '@/lib/status';

export default function CipGraphPage() {
  const { nodes, edges } = getCipRequiresGraph();

  // Group nodes by in-degree to identify "hubs". A simple force-free layout:
  // hubs at the centre, dependents around them. For a small graph this is
  // good enough and avoids shipping cytoscape.js.
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const e of edges) {
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    outDegree.set(e.from, (outDegree.get(e.from) ?? 0) + 1);
  }

  // Sort: hubs (high in-degree) first, then by id
  const sortedNodes = [...nodes].sort((a, b) => {
    const dIn = (inDegree.get(b.id) ?? 0) - (inDegree.get(a.id) ?? 0);
    if (dIn !== 0) return dIn;
    return a.id.localeCompare(b.id);
  });

  // Layout: put first 3 hubs in the middle column, others in outer columns
  const positions = new Map<string, { x: number; y: number }>();
  const W = 1000;
  const H = Math.max(400, sortedNodes.length * 70);
  const hubs = sortedNodes.filter(n => (inDegree.get(n.id) ?? 0) > 0);
  const leaves = sortedNodes.filter(n => (inDegree.get(n.id) ?? 0) === 0);
  hubs.forEach((n, i) => positions.set(n.id, {
    x: W / 2,
    y: 80 + i * (H - 160) / Math.max(hubs.length - 1, 1),
  }));
  leaves.forEach((n, i) => positions.set(n.id, {
    x: i % 2 === 0 ? W * 0.18 : W * 0.82,
    y: 70 + Math.floor(i / 2) * 110,
  }));

  return (
    <main className="pg rd">
      <Crumbs items={[{ label: 'CIPs', href: '/cips' }, { label: 'Dependency graph' }]} />
      <div className="rd-graph-wrap">
        <header className="pg-head">
          <div className="pg-head-copy">
            <div className="pg-head-top">
              <span className="pg-icon"><Network size={22} aria-hidden="true" /></span>
              <span className="pg-kicker">GOVERNANCE · CIP GRAPH</span>
            </div>
            <h1 className="pg-h1">CIP dependency graph</h1>
            <p className="pg-desc">
              Derived from the <code className="rd-inline-code">requires</code> field. Arrows go from a dependant to its dependency.
              CIPs without dependencies are not shown, only those in the requires graph.
            </p>
            <div className="pg-actions">
              <Link href="/cips" className="pg-btn pg-btn--line">
                <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />Back to list
              </Link>
            </div>
          </div>
          <div className="pg-stats">
            <div className="pg-stat"><b>{nodes.length}</b><span>nodes</span></div>
            <div className="pg-stat"><b>{edges.length}</b><span>dependencies</span></div>
            <div className="pg-stat"><b>{hubs.length}</b><span>referenced by 1 or more</span></div>
          </div>
        </header>

        {nodes.length === 0 ? (
          <div className="rd-empty">No CIP dependencies recorded yet.</div>
        ) : (
          <div className="rd-graph">
            <svg viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="CIP dependency graph">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--fg-mute)" />
                </marker>
              </defs>

              {edges.map((e, i) => {
                const from = positions.get(e.from);
                const to = positions.get(e.to);
                if (!from || !to) return null;
                const dx = to.x - from.x; const dy = to.y - from.y;
                const len = Math.hypot(dx, dy) || 1;
                const ux = dx / len; const uy = dy / len;
                const x1 = from.x + ux * 36; const y1 = from.y + uy * 18;
                const x2 = to.x - ux * 36;   const y2 = to.y - uy * 18;
                return (
                  <line key={i}
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke="var(--fg-mute)" strokeWidth="1.2" markerEnd="url(#arrow)"
                    opacity={0.55}
                  />
                );
              })}

              {sortedNodes.map(n => {
                const p = positions.get(n.id);
                if (!p) return null;
                const color = STATUS_COLOR[n.status ?? ''] ?? 'var(--fg-mute-text)';
                return (
                  <g key={n.id} transform={`translate(${p.x},${p.y})`}>
                    <a href={`/cips/${n.id}`}>
                      <rect
                        x={-44} y={-16} width={88} height={32} rx={8}
                        fill="var(--bg-card)" stroke={color} strokeWidth="1.5"
                      />
                      <text
                        x={0} y={4}
                        textAnchor="middle"
                        fontFamily="var(--mono)" fontSize={12} fontWeight={600}
                        fill={color}
                      >
                        CIP-{n.id}
                      </text>
                      <title>{`CIP-${n.id}: ${n.title}${n.status ? ` (${n.status})` : ''}`}</title>
                    </a>
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {edges.length > 0 && (
          <section>
            <h2 className="rd-section-h">Dependencies ({edges.length})</h2>
            <div className="pg-list">
              {edges.map((e, i) => {
                const from = nodes.find(n => n.id === e.from);
                const to = nodes.find(n => n.id === e.to);
                return (
                  <div key={i} className="rd-dep">
                    <Link href={`/cips/${e.from}`}>CIP-{e.from}</Link>
                    <span>requires</span>
                    <Link href={`/cips/${e.to}`}>CIP-{e.to}</Link>
                    {(from || to) && <span className="rd-dep-title">{to?.title ?? from?.title}</span>}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
