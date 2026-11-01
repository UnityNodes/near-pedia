import type { Metadata } from 'next';
import { LegalPage } from '@/components/reader-shell';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms of use for the YOURPEDIA YourChain knowledge aggregator.',
};

const LAST_UPDATED = '2026-09-21';

export default function TermsPage() {
  return (
    <LegalPage crumb="Terms of service">
      <header>
        <p className="legal-kicker">TERMS OF SERVICE</p>
        <h1>Terms of use</h1>
        <p className="legal-meta">Last updated: {LAST_UPDATED}</p>
      </header>

      <section>
        <h2>1. What YOURPEDIA is</h2>
        <p>
          YOURPEDIA is a free, read-only aggregator that pulls publicly available content from
          several YourChain sources into one place, CIPs (your-org/CIPs), the
          YourChain forum, the node and developer documentation,
          official whitepapers, blog and release announcements, and lets you search across all
          of them.
        </p>
        <p>
          YOURPEDIA is run by <strong>Your Organization</strong> as a convenience for the community. It
          is <strong>not affiliated</strong> with the YourChain Foundation, YourChain Labs,
          or any other organization in the official YourChain ecosystem.
        </p>
        <p>By using the site you agree to these terms. If you don&apos;t, please don&apos;t use it.</p>
      </section>

      <section>
        <h2>2. Source content stays with its owners</h2>
        <p>
          Every CIP, forum post, doc page and announcement displayed on YOURPEDIA
          belongs to its original author or publisher. We aggregate and re-display it under
          fair-use / community-knowledge principles and always link back to the source. Nothing
          on YOURPEDIA transfers copyright or grants new rights to anyone.
        </p>
        <p>
          The YOURPEDIA layout, design, and original code (the aggregator itself) is © 2026 Your Organization.
        </p>
      </section>

      <section>
        <h2>3. Acceptable use</h2>
        <p>Please don&apos;t:</p>
        <ul>
          <li>Try to bypass rate limits or other technical safeguards.</li>
          <li>Submit other people&apos;s personal data, secrets, or confidential material.</li>
          <li>Use the site to produce illegal or harmful content.</li>
        </ul>
        <p>We may block traffic that violates this without notice.</p>
      </section>

      <section>
        <h2>4. No warranty, no liability</h2>
        <p>
          The site is provided <strong>&quot;as is&quot;</strong>. We don&apos;t guarantee uptime, accuracy,
          completeness, or fit for any purpose. To the maximum extent allowed by law, Your
          Organization is not liable for any damages arising from your use of the site.
        </p>
      </section>

      <section>
        <h2>5. Changes</h2>
        <p>
          We may modify or shut down any part of the service at any time. We don&apos;t commit to
          preserving historical content or indexes.
        </p>
      </section>

      <section>
        <h2>6. Contact</h2>
        <p>
          Questions or notices about these terms: <a href="/contact">contact form</a>.
        </p>
      </section>
    </LegalPage>
  );
}
