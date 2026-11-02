import type { Metadata } from 'next';
import { LegalPage } from '@/components/reader-shell';
import { SITE } from '@/lib/site.config';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `How ${SITE.name} handles your data, short version, because we collect very little.`,
};

const LAST_UPDATED = '2026-09-21';

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
          publicly available NEAR content (CIPs, forum, docs,
          whitepapers, blog, releases). No accounts, no
          logins, no profiles.
        </p>
        <p>
          Contact: <a href="/contact">contact form</a>
        </p>
      </section>

      <section>
        <h2>2. What we collect</h2>
        <p>Almost nothing. Specifically:</p>
        <ul>
          <li>
            <strong>Theme preference</strong>: light/dark, stored in your browser&apos;s
            <code> localStorage</code>. Never reaches our server.
          </li>
        </ul>
        <p>
          We do <strong>not</strong> store the text of your queries, collect names or emails,
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
            <strong>Google Gemini</strong>:{' '}
            <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">terms</a>
          </li>
          <li>
            <strong>Groq</strong>:{' '}
            <a href="https://groq.com/privacy-policy" target="_blank" rel="noopener noreferrer">privacy</a>
          </li>
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
