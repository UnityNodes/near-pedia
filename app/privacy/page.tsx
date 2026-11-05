import type { Metadata } from 'next';
import { LegalPage } from '@/components/reader-shell';
import { SITE } from '@/lib/site.config';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `How ${SITE.name} handles your data, short version, because we collect very little.`,
};

const LAST_UPDATED = '2026-11-05';

export default function PrivacyPage() {
  return (
    <LegalPage crumb="Privacy policy">
      <header>
        <p className="legal-kicker">PRIVACY POLICY</p>
        <h1>How we handle your data</h1>
        <p className="legal-meta">Last updated: {LAST_UPDATED}</p>
      </header>

      <section>
        <h2>1. Who we are</h2>
        <p>
          {SITE.name} is operated by <strong>{SITE.publisher.name}</strong>. It is a read-only aggregator of
          publicly available NEAR content (docs, GitHub, packages, forum,
          governance, blogs, videos, releases). No accounts, no
          logins, no profiles.
        </p>
        <p>
          Contact: <a href="/contact">contact page</a>
        </p>
      </section>

      <section>
        <h2>2. What we collect</h2>
        <p>Very little, and nothing that identifies you. Specifically:</p>
        <ul>
          <li>
            <strong>Site search queries</strong>: the text typed into the search on this site
            and how many results it returned, to see what people look for and miss. No IP
            address, account or cookie is stored with it. Kept 180 days.
          </li>
          <li>
            <strong>MCP calls</strong>: which tool was called, when, whether it worked and how
            long it took. Not the arguments, not who called. Kept 180 days.
          </li>
          <li>
            <strong>/ask conversations</strong>: kept in your browser&apos;s
            <code> localStorage</code>, not on our server. The question itself is sent to
            NEAR AI Cloud to be answered (see 3).
          </li>
          <li>
            <strong>Theme preference</strong>: light/dark, stored in your browser&apos;s
            <code> localStorage</code>. Never reaches our server.
          </li>
          <li>
            <strong>Rate limiting</strong>: requests are counted per client address in memory
            to enforce the limit; the address is not written to disk.
          </li>
          <li>
            <strong>Contact form</strong>, only if you send a message: your email, the start of
            the subject and your IP address, to answer you and to stop abuse of the form.
          </li>
        </ul>
        <p>
          Beyond that we do <strong>not</strong> collect names or emails, keep access logs of visitors, or
          load third-party analytics, ad tags, or cross-site trackers.
        </p>
      </section>

      <section>
        <h2>3. Third-party AI providers</h2>
        <p>
          The following providers process text we send them under their own privacy terms:
        </p>
        <ul>
          <li>
            <strong>NEAR AI Cloud</strong> (answers on /ask, and the embeddings and reranking behind semantic search; models run in TEEs):{' '}
            <a href="https://near.ai/privacy-policy" target="_blank" rel="noopener noreferrer">privacy</a>
          </li>
          <li>
            <strong>Cloudflare Workers AI</strong> or <strong>Cohere</strong> (fallback reranking, only when NEAR AI Cloud is not configured):{' '}
            <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">Cloudflare privacy</a>
            {' · '}
            <a href="https://cohere.com/privacy" target="_blank" rel="noopener noreferrer">Cohere privacy</a>
          </li>
        </ul>
        <p>
          We don&apos;t control their retention.
        </p>
      </section>

      <section>
        <h2>4. Cookies</h2>
        <p>
          Only first-party, strictly-necessary cookies. No marketing
          cookies, no third-party trackers. You can clear them in your browser at any time.
        </p>
      </section>

      <section>
        <h2>5. Your rights</h2>
        <p>
          You can ask us to show or delete whatever rate-limit record we have on you. Use the{' '}
          <a href="/contact">contact form</a> and include the IP address you used so we can find it.
          We&apos;ll reply within 30 days.
        </p>
      </section>

      <section>
        <h2>6. Security</h2>
        <p>
          Served over HTTPS. The site runs on a server we operate ourselves; the SQLite database
          lives on that server and is not shared with any third party.
        </p>
      </section>

      <section>
        <h2>7. Changes</h2>
        <p>
          If anything material changes we&apos;ll bump the date at the top. Continued use after
          a change means you accept the update.
        </p>
      </section>
    </LegalPage>
  );
}
