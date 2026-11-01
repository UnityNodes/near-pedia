import {
  Activity, BookOpen, BookText, Boxes, CirclePlay, Code2, Database, FileText,
  Library, MessagesSquare, Newspaper, PenLine, Plug, Radar, ScrollText, ShieldCheck, Tag, TrendingUp,
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

export type NavGroupKey = 'governance' | 'learn' | 'community' | 'build' | 'monitor';

export interface NavGroup {
  key: NavGroupKey;
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'governance',
    label: t.nav_governance,
    items: [
      { href: '/cips', label: t.nav_cips, hint: 'Every proposal and its history', Icon: FileText },
      { href: '/whitepapers', label: t.nav_papers, hint: 'Research papers', Icon: ScrollText },
    ],
  },
  {
    key: 'learn',
    label: t.nav_learn,
    items: [
      { href: '/docs', label: t.nav_docs, hint: 'Guides and reference', Icon: BookOpen },
      { href: '/glossary', label: t.nav_glossary, hint: 'Terms, explained', Icon: BookText },
      { href: '/releases', label: t.nav_releases, hint: 'What shipped and when', Icon: Tag },
      { href: '/videos', label: t.nav_videos, hint: 'Talks with transcripts', Icon: CirclePlay },
      { href: '/digest', label: t.nav_digest, hint: 'The week in one read', Icon: Newspaper },
    ],
  },
  {
    key: 'community',
    label: t.nav_community,
    items: [
      { href: '/discussions', label: t.nav_forum, hint: 'Threads and answers', Icon: MessagesSquare },
      { href: '/blog', label: t.nav_blog, hint: 'News and write-ups', Icon: PenLine },
      { href: '/code', label: t.nav_code, hint: 'Repos, packages, examples', Icon: Code2 },
      { href: '/ecosystem', label: t.nav_ecosystem, hint: 'Projects building here', Icon: Boxes },
    ],
  },
  {
    key: 'build',
    label: t.nav_build,
    items: [
      { href: '/for-ai', label: t.nav_for_ai, hint: 'Connect an agent in a minute', Icon: Plug },
      { href: '/resources', label: t.nav_resources, hint: 'Starter paths and links', Icon: Library },
    ],
  },
  {
    key: 'monitor',
    label: t.nav_monitor,
    items: [
      { href: '/radar', label: t.nav_radar, hint: 'What is coming next', Icon: Radar },
      { href: '/validators', label: t.nav_validators, hint: 'Node operators', Icon: ShieldCheck },
      { href: '/feed', label: t.nav_feed, hint: 'Everything as it happens', Icon: Activity },
      { href: '/trending', label: t.nav_trending, hint: 'What people read now', Icon: TrendingUp },
      { href: '/sources', label: t.nav_sources, hint: 'What is indexed, and how fresh', Icon: Database },
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
