import Link from 'next/link';
import {
  Activity, ArrowRight, BookOpen, BookText, Boxes, Code2, Gauge, MessageCircleQuestion, MessagesSquare,
  Plug, Radar, ShieldAlert, Tag, type LucideIcon,
} from 'lucide-react';
import { HomeHero } from '@/components/home-hero';
import { SourcesLive } from '@/components/sources-live';
import { getSourceInventory } from '@/lib/sources';
import { getLatestReleases, getRecentFeed } from '@/lib/home-feed';
import { SITE, SITE_TITLE } from '@/lib/site.config';
import type { Metadata } from 'next';
import { JsonLd } from '@/components/json-ld';
import { getDb } from '@/lib/db';
import { getDeprecation } from '@/lib/deprecations';

export const revalidate = 60;

const DESCRIPTION = 'What NEAR removed, deprecated and changed, for AI agents writing NEAR code: check code and packages, follow protocol upgrades, governance and incidents, every answer with a source and a date.';

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: DESCRIPTION,
  alternates: { canonical: SITE.url },
  openGraph: { title: SITE_TITLE, description: DESCRIPTION, url: SITE.url },
  twitter: { title: SITE_TITLE, description: DESCRIPTION },
};

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: `What is ${SITE.name}?`,
      acceptedAnswer: { '@type': 'Answer', text: `${SITE.name} is a live knowledge layer for AI agents building on NEAR. It syncs NEAR's docs, packages, repositories, release notes, RPC and governance, and tells an agent when its code uses something NEAR removed, deprecated or changed, with the source and the date.` },
    },
    {
      '@type': 'Question',
      name: 'How does an agent use it?',
      acceptedAnswer: { '@type': 'Answer', text: `Through MCP at ${SITE.url}/mcp (no key) or the REST API: check_code checks a file, check_deprecation and resolve_package check a name or a package version, get_radar lists what is changing now.` },
    },
    {
      '@type': 'Question',
      name: 'Where do the answers come from?',
      acceptedAnswer: { '@type': 'Answer', text: 'From NEAR\'s own sources: docs.near.org, npm and crates.io, the NEAR GitHub organisations and their release notes, mainnet and testnet RPC, the House of Stake contracts, gov.near.org, NEAR Catalog and DefiLlama.' },
    },
  ],
};

const HERO_HEADLINE = 'NEAR';

const PATHS: { k: string; t: string; d: string; links: { href: string; label: string; Icon: LucideIcon }[] }[] = [
  {
    k: '01 · CHECK',
    t: 'Is my NEAR code current?',
    d: 'SDKs, packages, RPC methods and protocol features NEAR removed or replaced, each with its evidence and what to use instead.',
    links: [
      { href: '/deprecations', label: 'Deprecations', Icon: ShieldAlert },
      { href: '/ask', label: 'Ask', Icon: MessageCircleQuestion },
      { href: '/for-ai', label: 'Connect an agent', Icon: Plug },
    ],
  },
  {
    k: '02 · NOW',
    t: 'What is changing',
    d: 'Protocol upgrades and the validator vote, House of Stake votes, incidents and deadlines, each alert gone once it resolves.',
    links: [
      { href: '/radar', label: 'Radar', Icon: Radar },
      { href: '/protocol', label: 'Protocol', Icon: Gauge },
      { href: '/feed', label: 'Feed', Icon: Activity },
    ],
  },
  {
    k: '03 · LEARN',
    t: 'Docs and releases',
    d: 'docs.near.org and partner docs, release notes of nearcore, near-sdk, near-api-js and the rest, re-synced on their own cadence.',
    links: [
      { href: '/docs', label: 'Docs', Icon: BookOpen },
      { href: '/releases', label: 'Releases', Icon: Tag },
      { href: '/glossary', label: 'Glossary', Icon: BookText },
    ],
  },
  {
    k: '04 · ECOSYSTEM',
    t: 'Who builds what',
    d: 'NEAR Catalog with TVL, gov.near.org threads and the repositories of the NEAR organisations.',
    links: [
      { href: '/ecosystem', label: 'Ecosystem', Icon: Boxes },
      { href: '/discussions', label: 'Forum', Icon: MessagesSquare },
      { href: '/code', label: 'Code', Icon: Code2 },
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
  const sample = (() => {
    try {
      return getDeprecation(getDb(), 'near-sdk-js');
    } catch {
      return null;
    }
  })();
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
              <h2>Let your agent check before it writes.</h2>
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
              <div><span className="dp-term-mute">$</span> <span className="dp-term-acc">check_deprecation</span>(&quot;near-sdk-js&quot;)</div>
              {sample && (
                <div><span className="dp-term-mute">{sample.status.toUpperCase()} ({sample.strength} evidence){sample.replacement ? ` · use ${sample.replacement}` : ''}{sample.since ? ` · since ${sample.since.slice(0, 10)}` : ''}</span></div>
              )}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
