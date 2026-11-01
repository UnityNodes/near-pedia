import type { Metadata } from 'next';
import Link from 'next/link';
import { pageMetadata } from '@/lib/seo';
import { breadcrumbList } from '@/lib/jsonld';
import { JsonLd } from '@/components/json-ld';
import { ReaderHead, ReaderPage } from '@/components/reader-shell';

export const revalidate = 86400;

export const metadata: Metadata = pageMetadata({
  title: 'Security - Coordinated Disclosure',
  description:
    'How to responsibly report security vulnerabilities in YOURPEDIA, response timelines, scope, and acknowledgements.',
  path: '/security',
});

export default function SecurityPage() {
  const breadcrumb = breadcrumbList([
    { name: 'Home', path: '/' },
    { name: 'Security', path: '/security' },
  ]);

  return (
    <>
      <JsonLd payload={breadcrumb} />
      <ReaderPage crumbs={[{ label: 'Security' }]}>
        <ReaderHead
          tags={<span className="pg-tag" data-tone="lime">Coordinated disclosure</span>}
          title="Security disclosure"
          lede={
            <>
              How to report vulnerabilities in YOURPEDIA. Machine-readable copy at <Link href="/.well-known/security.txt">/.well-known/security.txt</Link>.
            </>
          }
        />

        <div className="rd-sec-list">
          <section>
            <h2 className="rd-section-h">Reporting</h2>
            <div className="rd-card">
              <p>
                Email <a href="mailto:security@example.com">security@example.com</a> or
                open a private advisory at <a href="https://github.com/your-org/yourpedia/security/advisories/new" target="_blank" rel="noopener noreferrer">github.com/your-org/yourpedia/security/advisories/new</a>.
                GitHub advisories are encrypted end-to-end and give a private audit trail; pick whichever you prefer.
                For non-security questions, use the <a href="/contact">contact form</a>.
              </p>
              <p className="rd-muted">
                Please include reproduction steps, affected URL or endpoint, browser/agent, and any logs you have.
                If the issue is sensitive, request a PGP key in your first message and we will respond out-of-band.
              </p>
            </div>
          </section>

          <section>
            <h2 className="rd-section-h">Response timeline</h2>
            <div className="rd-card">
              <ul>
                <li><b>72h:</b> initial acknowledgement.</li>
                <li><b>7d:</b> severity assessment and patch plan or risk acceptance.</li>
                <li><b>30d:</b> public disclosure once a fix is deployed, unless the reporter prefers earlier.</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="rd-section-h">Scope</h2>
            <div className="rd-card">
              <p><b>In scope:</b></p>
              <ul>
                <li>yourpedia.example and its subdomains.</li>
                <li>/api/v1/* REST endpoints, /mcp MCP server, /api/feed/* feeds.</li>
                <li>The metrics endpoint (/api/metrics).</li>
              </ul>
              <p><b>Out of scope:</b></p>
              <ul>
                <li>Rate-limit volume tests, denial-of-service, automated scanners.</li>
                <li>Issues only reproducible with a custom client that disables CSP or modifies bundled JS.</li>
                <li>Reports based on missing security headers without a concrete exploit.</li>
                <li>Third-party services we depend on (DefiLlama, Cohere, Groq, Gemini) - report those upstream.</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="rd-section-h">Safe harbour</h2>
            <div className="rd-card">
              <p>
                Good-faith research on this scope, conducted without privacy or availability damage, will not lead to legal action.
                Please avoid touching production data of other users (IPs).
              </p>
            </div>
          </section>

          <section id="acknowledgments">
            <h2 className="rd-section-h">Acknowledgements</h2>
            <div className="rd-card">
              <p className="rd-muted">
                No reports received yet. Future reporters who opt-in will be credited here with name + GitHub/Twitter handle.
              </p>
            </div>
          </section>
        </div>
      </ReaderPage>
    </>
  );
}
