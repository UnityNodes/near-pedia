import type { Metadata } from 'next';
import { SITE } from '@/lib/site.config';
import { AskApp } from './ask-app';
import './ask.css';

export const metadata: Metadata = {
  title: 'Ask',
  description: `Ask anything about NEAR: upgrades, House of Stake votes, projects, incidents or your code. Answered through NEAR AI Cloud from ${SITE.name}'s live sources, with a verifiable signature.`,
};

export default function AskPage() {
  return (
    <main className="ak-page">
      <h1 className="pg-sr">Ask anything about NEAR</h1>
      <AskApp />
    </main>
  );
}
