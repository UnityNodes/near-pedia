import Link from 'next/link';
import { Bot, Code2, Compass, Server } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { docHost, getDocIdByUrl } from '@/lib/docs';
import { SITE_URL } from '@/lib/seo';

const HERO_CARDS: { title: string; desc: string; doc?: string; href?: string; icon: LucideIcon; go: string }[] = [
  {
    title: 'New to NEAR?',
    desc: 'What the network is, how accounts and access keys work, and where to start.',
    doc: 'https://docs.near.org/getting-started/what-is-near',
    icon: Compass,
    go: 'Read the overview',
  },
  {
    title: 'Your first contract',
    desc: 'Write, test and deploy a smart contract in Rust or JavaScript.',
    doc: 'https://docs.near.org/smart-contracts/quickstart',
    icon: Code2,
    go: 'Start building',
  },
  {
    title: 'Tools for AI agents',
    desc: 'What NEAR gives an agent: MCP servers, skills and documentation in agent-readable form.',
    doc: 'https://docs.near.org/getting-started/tools-for-ai',
    icon: Bot,
    go: 'See the tools',
  },
  {
    title: 'Validators',
    desc: 'How block producers are chosen, paid and rotated each epoch.',
    doc: 'https://docs.near.org/protocol/network/validators',
    icon: Server,
    go: 'Read about validators',
  },
];

export function cardHref(card: { doc?: string; href?: string }, idOf: (url: string) => number | null = getDocIdByUrl): string {
  if (card.href) return card.href;
  const id = card.doc ? idOf(card.doc) : null;
  return id === null ? '/docs' : `/docs/${id}`;
}

export function DocsLanding() {
  return (
    <nav aria-label="Start here" className="pg-cards">
      {HERO_CARDS.map((card, i) => {
        const Icon = card.icon;
        return (
          <Link key={card.title} href={cardHref(card)} className="pg-card dx-path" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="dx-path-top">
              <span className="dx-path-icon"><Icon size={18} strokeWidth={1.75} aria-hidden="true" /></span>
              <span className="dx-path-host">{docHost(card.doc ?? SITE_URL)}</span>
            </span>
            <b>{card.title}</b>
            <p>{card.desc}</p>
            <span className="pg-card-foot">{card.go} →</span>
          </Link>
        );
      })}
    </nav>
  );
}
