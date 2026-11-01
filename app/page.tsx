import Link from 'next/link';
import {
  ArrowRight, BookOpen, Boxes, CirclePlay, Code2, FileText, GitPullRequest, MessagesSquare,
  PenLine, Radar, ScrollText, ShieldCheck, Tag, BookText, type LucideIcon,
} from 'lucide-react';
import { HomeHero } from '@/components/home-hero';
import { SourcesLive } from '@/components/sources-live';
import { getSourceInventory } from '@/lib/sources';
import { getLatestReleases, getRecentFeed } from '@/lib/home-feed';
import { SITE } from '@/lib/site.config';
import type { Metadata } from 'next';
import { JsonLd } from '@/components/json-ld';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'YOURPEDIA | YourChain Knowledge Hub',
  description: 'CIPs, docs, discussions and whitepapers for the YourChain ecosystem, indexed, searchable, always current.',
  alternates: { canonical: 'https://yourpedia.example' },
  openGraph: {
    title: 'YOURPEDIA | YourChain Knowledge Hub',
    description: 'CIPs, docs, discussions and whitepapers for the YourChain ecosystem, indexed, searchable, always current.',
    url: 'https://yourpedia.example',
  },
  twitter: {
    title: 'YOURPEDIA | YourChain Knowledge Hub',
    description: 'CIPs, docs, discussions and whitepapers for the YourChain ecosystem, indexed, searchable, always current.',
  },
};

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is YOURPEDIA?',
      acceptedAnswer: { '@type': 'Answer', text: 'YOURPEDIA is the central knowledge hub for the YourChain ecosystem, indexing Chain Improvement Proposals (CIPs), technical documentation, governance discussions, whitepapers, and developer resources in one searchable, always-current platform.' },
    },
    {
      '@type': 'Question',
      name: 'What is a Chain Improvement Proposal (CIP)?',
      acceptedAnswer: { '@type': 'Answer', text: 'A Chain Improvement Proposal (CIP) is a formal technical document that defines standards, protocols, and upgrades for YourChain, similar to Ethereum\'s EIPs or Bitcoin\'s BIPs. CIPs go through Draft, Review, Final, and other statuses before adoption.' },
    },
    {
      '@type': 'Question',
      name: 'What is YourChain?',
      acceptedAnswer: { '@type': 'Answer', text: 'YourChain is a blockchain network. Validators secure it, TKN is its native token, and protocol changes are proposed and discussed through Chain Improvement Proposals (CIPs). Developers can run nodes and build applications on it.' },
    },
    {
      '@type': 'Question',
      name: 'What content does YOURPEDIA index?',
      acceptedAnswer: { '@type': 'Answer', text: 'YOURPEDIA indexes CIPs, the YourChain and node documentation, forum discussions from forum.yourchain.example, whitepapers, news, blog posts, and videos related to the YourChain ecosystem.' },
    },
  ],
};

const HERO_HEADLINE = 'YourChain ecosystem';

const PATHS: { k: string; t: string; d: string; links: { href: string; label: string; Icon: LucideIcon }[] }[] = [
  {
    k: '01 · GOVERNANCE',
    t: 'Proposals and governance',
    d: 'Every proposal with its full status history, cross-linked to the threads that shaped it.',
    links: [
      { href: '/cips', label: 'CIPs', Icon: FileText },
      { href: '/cips?view=prs', label: 'Pull requests', Icon: GitPullRequest },
      { href: '/whitepapers', label: 'Whitepapers', Icon: ScrollText },
    ],
  },
  {
    k: '02 · LEARN',
    t: 'Documentation',
    d: 'The official docs and guides, re-synced on their own cadence and never paraphrased.',
    links: [
      { href: '/docs', label: 'Docs', Icon: BookOpen },
      { href: '/glossary', label: 'Glossary', Icon: BookText },
      { href: '/videos', label: 'Videos', Icon: CirclePlay },
    ],
  },
  {
    k: '03 · COMMUNITY',
    t: 'Community',
    d: 'Forum threads, discussions and posts from across the ecosystem, ranked by relevance.',
    links: [
      { href: '/discussions', label: 'Forum', Icon: MessagesSquare },
      { href: '/blog', label: 'Blog', Icon: PenLine },
      { href: '/ecosystem', label: 'Ecosystem', Icon: Boxes },
    ],
  },
  {
    k: '04 · NETWORK',
    t: 'Build and monitor',
    d: 'Releases, code, validators and the radar, kept current from their primary sources.',
    links: [
      { href: '/releases', label: 'Releases', Icon: Tag },
      { href: '/code', label: 'Code', Icon: Code2 },
      { href: '/validators', label: 'Validators', Icon: ShieldCheck },
      { href: '/radar', label: 'Radar', Icon: Radar },
    ],
  },
];

export default async function Home() {
  const sourcesInventory = await getSourceInventory();
  const feed = getRecentFeed(6);
  const releases = getLatestReleases(3);
  const toolsLine = sourcesInventory.mcp_tools_count > 0
    ? `${sourcesInventory.mcp_tools_count} MCP tools over the same index.`
    : 'MCP tools over the same index.';
  const endpoint = `${SITE.url}/mcp`;
  const serverName = SITE.name.toLowerCase();

  return (
    <>
      <JsonLd payload={faqSchema} />
      <main className="dp-home">
        <HomeHero
          sourceCount={sourcesInventory.source_count}
          headline={HERO_HEADLINE}
          panel={<SourcesLive stickers initial={{ ...sourcesInventory, avg_latency_ms: null }} />}
        />

        <section className="dp-section dp-reveal" aria-label="Where to start">
          <div className="dp-section-head">
            <div className="dp-kicker">START WHERE YOU ARE</div>
            <h2 className="dp-h2">Four ways in.</h2>
          </div>
          <div className="dp-paths">
            {PATHS.map((p) => (
              <div key={p.k} className="dp-path">
                <span className="dp-path-k">{p.k}</span>
                <div>
                  <h3>{p.t}</h3>
                  <p>{p.d}</p>
                </div>
                <div className="dp-path-links">
                  {p.links.map(({ href, label, Icon }) => (
                    <Link key={href} href={href} className="dp-path-link">
                      <span><Icon size={15} aria-hidden="true" />{label}</span>
                      <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="dp-section dp-pair dp-reveal" aria-label="Recent activity">
          <div className="dp-card">
            <div className="dp-card-head">
              <span className="dp-live-label">
                <span className="dp-ping" aria-hidden="true"><span className="dp-ping-ring" /><span className="dp-ping-core" /></span>
                JUST SYNCED
              </span>
              <Link href="/feed" className="dp-card-link">live feed →</Link>
            </div>
            <div className="dp-feed">
              {feed.map((f, i) => (
                <Link key={`${f.href}-${i}`} href={f.href} className="dp-feed-row" style={{ animationDelay: `${i * 60}ms` }}>
                  <span className="dp-feed-kind">{f.kind}</span>
                  <span className="dp-feed-title">{f.title}</span>
                  {f.fresh ? <span className="dp-new">NEW</span> : <span className="dp-feed-ago">{f.agoLabel}</span>}
                </Link>
              ))}
              {feed.length === 0 && <div className="dp-empty">Nothing synced yet.</div>}
            </div>
          </div>

          <div className="dp-card dp-card--stack">
            <div className="dp-card-head">
              <span className="dp-kicker dp-kicker--acc">LATEST RELEASES</span>
              <Link href="/releases" className="dp-card-link">
                {releases.total > 0 ? `All ${releases.total}` : 'All'} →
              </Link>
            </div>
            {releases.rows.map((r) => (
              <Link key={r.id} href={`/releases/${r.id}`} className="dp-release">
                <div>
                  <div className="dp-release-t">{r.name}</div>
                  <div className="dp-release-m">{r.repo}{r.prerelease ? ' · pre-release' : ''}</div>
                </div>
                <span className="dp-release-d">{r.agoLabel}</span>
              </Link>
            ))}
            {releases.rows.length === 0 && <div className="dp-empty">No releases synced yet.</div>}
          </div>
        </section>

        <section className="dp-section dp-reveal" aria-label="For AI agents">
          <div className="dp-agents">
            <div className="dp-agents-copy">
              <span className="dp-kicker">FOR AI AGENTS</span>
              <h2>Give your agent the whole index.</h2>
              <p>{toolsLine} No API key, no signup, read only.</p>
              <div className="dp-agents-cta">
                <Link href="/for-ai" className="dp-btn-dark">MCP Setup →</Link>
                <a href="/api/v1/reference" className="dp-btn-line">Open the REST API</a>
              </div>
            </div>
            <div className="dp-term" aria-label="Example MCP session">
              <div><span className="dp-term-mute">$</span> claude mcp add --transport http {serverName} {endpoint}</div>
              <div>
                <span className="dp-term-ok">✓</span>{' '}
                <span className="dp-term-mute">
                  connected{sourcesInventory.mcp_tools_count > 0 ? ` · ${sourcesInventory.mcp_tools_count} tools available` : ''}
                </span>
              </div>
              <div><span className="dp-term-mute">$</span> <span className="dp-term-acc">search</span>(&quot;validator rewards&quot;)</div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
