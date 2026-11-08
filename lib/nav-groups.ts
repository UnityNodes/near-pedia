import {
  Activity, BookOpen, Boxes, Code2, Database, FileCheck2, Gauge, MessageCircleQuestion,
  Landmark, MessagesSquare, PenLine, Plug, Radar, ShieldAlert, Tag,
  type LucideIcon,
} from 'lucide-react';
import { TRANSLATIONS } from './i18n';

const t = TRANSLATIONS.en;

export interface NavItem {
  href: string;
  label: string;
  hint: string;
  Icon: LucideIcon;
}

export type NavGroupKey = 'check' | 'now' | 'learn' | 'ecosystem' | 'build';

export interface NavGroup {
  key: NavGroupKey;
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'check',
    label: 'Check',
    items: [
      { href: '/check', label: 'Check code', hint: 'Paste a file, see what NEAR removed in it', Icon: FileCheck2 },
      { href: '/deprecations', label: 'Deprecations', hint: 'What NEAR removed, deprecated or replaced', Icon: ShieldAlert },
      { href: '/ask', label: 'Ask', hint: 'Answered through NEAR AI Cloud, verified', Icon: MessageCircleQuestion },
    ],
  },
  {
    key: 'now',
    label: 'Now',
    items: [
      { href: '/radar', label: t.nav_radar, hint: 'What is changing, until it resolves', Icon: Radar },
      { href: '/protocol', label: 'Protocol', hint: 'Versions and the validator vote', Icon: Gauge },
      { href: '/governance', label: 'Governance', hint: 'House of Stake proposals and votes', Icon: Landmark },
      { href: '/feed', label: t.nav_feed, hint: 'Everything as it happens', Icon: Activity },
      { href: '/sources', label: t.nav_sources, hint: 'What is indexed, and how fresh', Icon: Database },
    ],
  },
  {
    key: 'learn',
    label: t.nav_learn,
    items: [
      { href: '/docs', label: t.nav_docs, hint: 'docs.near.org and partner docs', Icon: BookOpen },
      { href: '/releases', label: t.nav_releases, hint: 'What shipped and when', Icon: Tag },
    ],
  },
  {
    key: 'ecosystem',
    label: 'Ecosystem',
    items: [
      { href: '/ecosystem', label: t.nav_ecosystem, hint: 'NEAR Catalog projects', Icon: Boxes },
      { href: '/discussions', label: t.nav_forum, hint: 'gov.near.org threads', Icon: MessagesSquare },
      { href: '/code', label: t.nav_code, hint: 'Repositories and issues', Icon: Code2 },
      { href: '/blog', label: t.nav_blog, hint: 'News and write-ups', Icon: PenLine },
    ],
  },
  {
    key: 'build',
    label: t.nav_build,
    items: [
      { href: '/for-ai', label: t.nav_for_ai, hint: 'Connect an agent in a minute', Icon: Plug },
    ],
  },
];

export function findNavItem(pathname: string): { group: NavGroup; item: NavItem } | null {
  let best: { group: NavGroup; item: NavItem } | null = null;
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (matches && (!best || item.href.length > best.item.href.length)) best = { group, item };
    }
  }
  return best;
}
