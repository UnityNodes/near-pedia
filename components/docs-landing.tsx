import Link from 'next/link';
import { Code2, Compass, FileText, Server } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { docHost, getDocIdByUrl } from '@/lib/docs';
import { SITE_URL } from '@/lib/seo';

const HERO_CARDS: { title: string; desc: string; doc?: string; href?: string; icon: LucideIcon; go: string }[] = [
  {
    title: 'New to YourChain?',
    desc: 'Overview of the YourChain network and its architecture.',
    doc: 'https://docs.example.com/overview',
    icon: Compass,
    go: 'Read the overview',
  },
  {
    title: 'Run a Node',
    desc: 'Step-by-step node onboarding, hardware requirements, and deployment.',
    doc: 'https://docs.example.com/run-a-node',
    icon: Server,
    go: 'Open the node guide',
  },
  {
    title: 'Build an Application',
    desc: 'Deploy your own contract or application on YourChain.',
    doc: 'https://docs.example.com/build',
    icon: Code2,
    go: 'Start building',
  },
  {
    title: 'Read the Whitepaper',
    desc: 'The foundational whitepaper describing YourChain architecture and vision.',
    href: '/whitepapers/yourchain-whitepaper',
    icon: FileText,
    go: 'Read the whitepaper',
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
