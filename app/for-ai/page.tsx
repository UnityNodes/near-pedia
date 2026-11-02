import { Activity, Boxes, ChevronRight, Code2, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { pageMetadata } from '@/lib/seo';
import { getDb } from '@/lib/db';
import { MCP_TOOL_COUNT, REST_ENDPOINT_COUNT, listMcpTools, shortDesc } from '@/lib/mcp-meta';
import { ENDPOINTS } from '@/lib/api-endpoints';
import { PageShell } from '@/components/page-shell';
import { ClientTabs } from './client-tabs';
import { CodeCard } from './code-card';
import { CopyButton } from './copy-button';
import {
  API_BASE_URL, IDE_CONFIGS, MCP_TOOLS_FALLBACK, MCP_URL, RATE_LIMITS, REST_EXAMPLES, TROUBLESHOOTING,
} from './data';
import { groupTools } from './tool-groups';
import './design.css';
import { SITE } from '@/lib/site.config';

interface ForAiContent {
  deprecations: number;
  docs: number;
  releases: number;
  packages: number;
  issues: number;
  forum: number;
  proposals: number;
  embeddingChunks: number;
}

function getForAiContent(): ForAiContent {
  const db = getDb();
  const n = (q: string): number => {
    try { return (db.prepare(q).get() as { c: number }).c; } catch { return 0; }
  };
  return {
    deprecations: n('SELECT COUNT(*) as c FROM deprecations'),
    docs: n('SELECT COUNT(*) as c FROM doc_pages'),
    releases: n('SELECT COUNT(*) as c FROM github_releases'),
    packages: n('SELECT COUNT(*) as c FROM packages'),
    issues: n("SELECT COUNT(*) as c FROM github_items WHERE state = 'open'"),
    forum: n('SELECT COUNT(*) as c FROM forum_topics'),
    proposals: n('SELECT COUNT(*) as c FROM hos_proposals'),
    embeddingChunks: n('SELECT COUNT(*) as c FROM embedding_chunks'),
  };
}

export const revalidate = 300;

export const metadata = pageMetadata({
  title: `${SITE.name} for AI | MCP + REST API`,
  description: `Machine-readable access to the NEAR knowledge base via MCP server (${MCP_TOOL_COUNT} tools) and REST API v1 (${REST_ENDPOINT_COUNT} endpoints).`,
  path: '/for-ai',
});

const GROUP_ICONS: Record<string, LucideIcon> = {
  code: Code2,
  ecosystem: Activity,
  everyone: Users,
  other: Boxes,
};

const PROTOCOL: { k: string; v: string }[] = [
  { k: 'Version', v: '2024-11-05' },
  { k: 'Transport', v: 'HTTP' },
  { k: 'Auth', v: 'None' },
  { k: 'CORS', v: '*' },
  { k: 'Format', v: 'JSON / SSE' },
];

const STAGGER_MS = 60;

export default async function ForAiPage() {
  const content = getForAiContent();
  const liveTools = await listMcpTools();
  const toolList = liveTools.length
    ? liveTools.map(t => ({ name: t.name, desc: shortDesc(t.description) }))
    : MCP_TOOLS_FALLBACK;
  const groups = groupTools(toolList);

  const indexed: { k: string; v: number }[] = [
    { k: 'Deprecations', v: content.deprecations },
    { k: 'Docs pages', v: content.docs },
    { k: 'Releases', v: content.releases },
    { k: 'Packages', v: content.packages },
    { k: 'Open issues and PRs', v: content.issues },
    { k: 'Forum threads', v: content.forum },
    { k: 'HoS proposals', v: content.proposals },
    { k: 'Search chunks', v: content.embeddingChunks },
  ];

  return (
    <PageShell
      href="/for-ai"
      title="MCP Setup"
      kicker={`BUILD · ${SITE.name} FOR AI AGENTS`}
      description={(
        <>
          Give your agent what NEAR looks like today: is this API still alive, what replaced it, what changed this week.
          {' '}{SITE.name} serves it over <span className="fa-em">MCP</span> and a <span className="fa-em">REST API</span>,
          with a source and a date on every answer. No authentication required.
        </>
      )}
      stat={{ value: toolList.length, unit: toolList.length === 1 ? 'MCP tool' : 'MCP tools' }}
    >
      <div className="fa">
        <div className="pg-actions">
          <a href="/api/v1/reference" className="pg-btn">Interactive API reference →</a>
          <a href={MCP_URL} target="_blank" rel="noopener noreferrer" className="pg-btn pg-btn--line">MCP Endpoint ↗</a>
          <a href="/api/v1" target="_blank" rel="noopener noreferrer" className="pg-btn pg-btn--line">API Index (JSON) ↗</a>
          <a href="/llms.txt" target="_blank" rel="noopener noreferrer" className="pg-btn pg-btn--line">llms.txt ↗</a>
        </div>

        <section className="fa-sec" aria-labelledby="fa-mcp">
          <div className="fa-sec-head">
            <span className="fa-sec-k">01</span>
            <h2 id="fa-mcp" className="fa-h2">MCP Server</h2>
          </div>

          <div className="fa-endpoint">
            <span className="fa-endpoint-label">ENDPOINT</span>
            <code>{MCP_URL}</code>
            <CopyButton text={MCP_URL} what="MCP endpoint" />
          </div>

          <h3 className="fa-sub">Install in your IDE / editor ({IDE_CONFIGS.length})</h3>
          <ClientTabs configs={IDE_CONFIGS} />

          <h3 className="fa-sub">Available tools ({toolList.length})</h3>
          <div className="fa-cats">
            {groups.map((group, i) => {
              const Icon = GROUP_ICONS[group.key] ?? Boxes;
              return (
                <section
                  key={group.key}
                  className="fa-cat"
                  aria-labelledby={`fa-cat-${group.key}`}
                  style={{ animationDelay: `${i * STAGGER_MS}ms` }}
                >
                  <div className="fa-cat-head">
                    <span className="fa-cat-icon"><Icon size={18} strokeWidth={1.75} aria-hidden="true" /></span>
                    <h4 id={`fa-cat-${group.key}`} className="fa-cat-title">{group.title}</h4>
                    <span className="fa-cat-n">{group.tools.length} {group.tools.length === 1 ? 'tool' : 'tools'}</span>
                  </div>
                  <p className="fa-cat-desc">{group.blurb}</p>
                  <ul className="fa-tools">
                    {group.tools.map(t => (
                      <li key={t.name} className="fa-tool">
                        <code>{t.name}</code>
                        <span>{t.desc}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </section>

        <section className="fa-sec" aria-labelledby="fa-trouble">
          <div className="fa-sec-head">
            <span className="fa-sec-k">02</span>
            <h2 id="fa-trouble" className="fa-h2">Troubleshooting</h2>
          </div>
          <div className="fa-acc">
            {TROUBLESHOOTING.map(item => (
              <details key={item.q}>
                <summary>
                  <ChevronRight className="fa-chev" size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span>{item.q}</span>
                </summary>
                <div className="fa-acc-body">{item.a}</div>
              </details>
            ))}
          </div>
        </section>

        <section className="fa-sec" aria-labelledby="fa-rest">
          <div className="fa-sec-head">
            <span className="fa-sec-k">03</span>
            <h2 id="fa-rest" className="fa-h2">REST API v1</h2>
          </div>

          <div className="fa-endpoint">
            <span className="fa-endpoint-label">BASE URL</span>
            <code>{API_BASE_URL}</code>
            <CopyButton text={API_BASE_URL} what="REST base URL" />
          </div>

          <h3 className="fa-sub">Quick examples</h3>
          <CodeCard label="SHELL" code={REST_EXAMPLES} what="REST examples" />

          <h3 className="fa-sub">Endpoints ({ENDPOINTS.length})</h3>
          <ul className="fa-list">
            {ENDPOINTS.map(e => (
              <li key={e.path} className="fa-ep">
                <code>{e.path}</code>
                <span className="fa-ep-desc">{e.desc}</span>
                {e.params ? <span className="fa-ep-params">{e.params}</span> : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="fa-sec" aria-labelledby="fa-ref">
          <div className="fa-sec-head">
            <span className="fa-sec-k">04</span>
            <h2 id="fa-ref" className="fa-h2">Reference</h2>
          </div>
          <div className="fa-ref">
            <div className="fa-ref-card">
              <h3 className="fa-sub">Protocol</h3>
              <dl className="fa-kvs">
                {PROTOCOL.map(row => (
                  <div key={row.k} className="fa-kv"><dt>{row.k}</dt><dd>{row.v}</dd></div>
                ))}
              </dl>
            </div>

            <div className="fa-ref-card">
              <h3 className="fa-sub">Content</h3>
              <dl className="fa-kvs">
                {indexed.map(row => (
                  <div key={row.k} className="fa-kv"><dt>{row.k}</dt><dd>{row.v.toLocaleString('en-US')}</dd></div>
                ))}
              </dl>
            </div>

            <div className="fa-ref-card">
              <h3 className="fa-sub">Rate limits</h3>
              <dl className="fa-kvs">
                {RATE_LIMITS.map(r => (
                  <div key={r.route} className="fa-kv fa-kv--route"><dt><code>{r.route}</code></dt><dd>{r.limit}</dd></div>
                ))}
              </dl>
              <p className="fa-ref-note">
                Limits returned in <code>RateLimit-*</code> headers. On 429, check <code>Retry-After</code>.
              </p>
            </div>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
