import type { Metadata } from 'next';
import { LegalPage } from '@/components/reader-shell';
import { SITE } from '@/lib/site.config';
import { AskForm } from './ask-form';

export const metadata: Metadata = {
  title: 'Ask',
  description: `Ask anything about NEAR: upgrades, House of Stake votes, projects, incidents or your code. Answered through NEAR AI Cloud from ${SITE.name}'s live sources, with a verifiable signature.`,
};

export default function AskPage() {
  return (
    <LegalPage crumb="Ask">
      <header>
        <p className="legal-kicker">ASK</p>
        <h1>Ask anything about NEAR</h1>
        <p className="legal-meta">
          Answered by a model running in a Trusted Execution Environment on NEAR AI Cloud, only from the sources this
          index holds today, each linked with the date we read it.
        </p>
      </header>

      <AskForm />

      <section>
        <h2>What happens to what you send</h2>
        <ul>
          <li>
            Your question and any pasted file are matched against this index (docs, deprecations, protocol state, House of Stake proposals, NEAR Catalog projects, security incidents, the forum, blogs, videos and GitHub issues, the radar) and run through{' '}
            <code>check_code</code> on this server, in memory. Nothing you send is stored or logged.
          </li>
          <li>
            The request then leaves this server encrypted to the model&apos;s key, taken from the model&apos;s verified hardware
            attestation: NEAR AI&apos;s gateway relays it without reading it.
          </li>
          <li>
            The answer is shown only if its signature verifies. The receipt below each answer opens NEAR AI&apos;s Verification
            Center, which checks the signature and the hardware evidence in your browser.
          </li>
        </ul>
      </section>
    </LegalPage>
  );
}
