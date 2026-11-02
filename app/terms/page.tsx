import type { Metadata } from 'next';
import { LegalPage } from '@/components/reader-shell';
import { SITE } from '@/lib/site.config';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: `Terms of use for the ${SITE.name} NEAR knowledge aggregator.`,
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
        <h2>1. What {SITE.name} is</h2>
        <p>
          {SITE.name} is a free, read-only aggregator that pulls publicly available content from
          NEAR sources into one place: docs.near.org and the Nomicon, GitHub repositories, releases
          and issues, npm and crates.io, the gov.near.org forum, House of Stake proposals, the NEAR
          and NEAR AI blogs and videos, and the NEAR Catalog. It lets people and AI agents search
          across all of them, and checks code against what NEAR looks like today.
        </p>
        <p>
          {SITE.name} is run by <strong>{SITE.publisher.name}</strong> as a convenience for the community. It
          is <strong>not affiliated</strong> with the NEAR Foundation or any other organization
          in the NEAR ecosystem.
        </p>
        <p>By using the site you agree to these terms. If you don&apos;t, please don&apos;t use it.</p>
      </section>

      <section>
        <h2>2. Source content stays with its owners</h2>
        <p>
          Every doc page, forum post, issue, release note and announcement displayed on {SITE.name}
          belongs to its original author or publisher. We aggregate and re-display it under
          fair-use / community-knowledge principles and always link back to the source. Nothing
          on {SITE.name} transfers copyright or grants new rights to anyone.
        </p>
        <p>
          The {SITE.name} code (the aggregator itself) is © 2026 {SITE.publisher.name}, released under the MIT licence.
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
          completeness, or fit for any purpose. To the maximum extent allowed by law,{' '}
          {SITE.publisher.name} is not liable for any damages arising from your use of the site.
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
