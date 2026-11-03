import type { Metadata } from 'next';
import { Crumbs } from '@/components/reader-shell';
import { SITE } from '@/lib/site.config';
import { AskChat } from './ask-chat';
import './ask.css';

export const metadata: Metadata = {
  title: 'Ask',
  description: `Ask anything about NEAR: upgrades, House of Stake votes, projects, incidents or your code. Answered through NEAR AI Cloud from ${SITE.name}'s live sources, with a verifiable signature.`,
};

export default function AskPage() {
  return (
    <main className="pg ak">
      <Crumbs items={[{ label: 'Ask' }]} />
      <header className="ak-head">
        <p className="ak-kicker">Ask · NEAR AI Cloud</p>
        <h1>Ask anything about NEAR</h1>
        <p className="ak-lede">
          Answered by a model in a Trusted Execution Environment, only from the sources this index holds today, each
          numbered with the date we read it. Every answer is shown only once its signature verifies.
        </p>
      </header>

      <AskChat />

      <details className="ak-privacy">
        <summary>What happens to what you send</summary>
        <ul>
          <li>
            Your question, the last three exchanges of this chat and any pasted file are matched against this index (docs,
            deprecations, protocol state, House of Stake proposals, NEAR Catalog projects, security incidents, the forum, blogs,
            videos and GitHub issues, the radar) and run through <code>check_code</code> on this server, in memory. Nothing you
            send is stored or logged on the server; the chat itself stays in your browser until you start a new one.
          </li>
          <li>
            The request then leaves this server encrypted to the model&apos;s key, taken from the model&apos;s verified hardware
            attestation: NEAR AI&apos;s gateway relays it without reading it.
          </li>
          <li>
            The answer is shown only if its signature verifies. The receipt under each answer opens NEAR AI&apos;s Verification
            Center, which checks the signature and the hardware evidence in your browser.
          </li>
          <li>Each address can ask 30 questions an hour.</li>
        </ul>
      </details>
    </main>
  );
}
