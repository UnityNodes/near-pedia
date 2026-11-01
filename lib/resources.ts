export type ResourceSection = 'start' | 'build' | 'community' | 'learn';

export interface ResourceLink {
  section: ResourceSection;
  group: string;
  title: string;
  url: string;
  note: string;
  expect?: string;
  unverifiable?: boolean;
  verifiedAt: string;
}

export const RESOURCE_SECTIONS: { id: ResourceSection; title: string; tagline: string; intro: string }[] = [
  { id: 'start', title: 'Start here', tagline: 'Begin here', intro: 'The first pages to read.' },
  { id: 'build', title: 'Build', tagline: 'Make something', intro: 'APIs, tooling and code.' },
  { id: 'community', title: 'Community', tagline: 'Find your people', intro: 'Where people talk.' },
  { id: 'learn', title: 'Learn', tagline: 'Go deeper', intro: 'Explainers, papers and talks.' },
];

export const MAX_AGE_DAYS = 90;

const V = '2026-10-23';

function l(section: ResourceSection, group: string, title: string, url: string, note: string, extra: Partial<Pick<ResourceLink, 'expect' | 'unverifiable'>> = {}): ResourceLink {
  return { section, group, title, url, note, verifiedAt: V, ...extra };
}

export const RESOURCES: ResourceLink[] = [
  l('start', 'On this site', 'Documentation', '/docs', 'Indexed documentation.'),
  l('start', 'On this site', 'Search', '/search', 'Search every source at once.'),
  l('build', 'On this site', 'MCP server and API', '/for-ai', 'Use the knowledge base from an AI agent.'),
  l('build', 'On this site', 'Sources', '/sources', 'What this site indexes and how fresh each source is.'),
  l('community', 'On this site', 'Forum', '/discussions', 'Discussions from the forum.'),
  l('community', 'On this site', 'Contact', '/contact', 'Write to the maintainers.'),
  l('learn', 'On this site', 'Whitepapers', '/whitepapers', 'Papers and long reads.'),
  l('learn', 'On this site', 'Proposals', '/cips', 'Improvement proposals and their history.'),
];

export type LinkKind = 'Docs' | 'Code' | 'Video' | 'Forum' | 'Chat' | 'This site' | 'Link';

export const SEARCH_SUGGESTIONS = ['forum', 'search', 'api', 'papers', 'proposals'];

export function linkHost(url: string): string {
  return url.startsWith('/') ? 'this site' : new URL(url).host.replace(/^www\./, '');
}

export function linkKind(link: Pick<ResourceLink, 'url'>): LinkKind {
  if (link.url.startsWith('/')) return 'This site';
  const host = new URL(link.url).host.replace(/^www\./, '');
  if (host === 'youtu.be' || host === 'youtube.com') return 'Video';
  if (host === 'github.com') return 'Code';
  if (host === 'discord.com' || host === 't.me') return 'Chat';
  if (host.startsWith('forum.') || host.startsWith('discuss.')) return 'Forum';
  if (host.startsWith('docs.')) return 'Docs';
  return 'Link';
}

export function linkMatches(link: ResourceLink, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${link.title} ${link.note} ${linkHost(link.url)} ${link.group}`.toLowerCase();
  return q.split(/\s+/).every(part => hay.includes(part));
}

export const FACTS_TITLE = 'In short';

export interface LearnFact {
  id: string;
  text: string;
  sourceTitle: string;
  url: string;
  evidenceUrl?: string;
  evidence: string;
  verifiedAt: string;
}

export const LEARN_FACTS: LearnFact[] = [];

export interface PageLink {
  slot: 'panel-head' | 'panel-foot' | 'note';
  href: string;
  label: string;
}

export const PAGE_LINKS: PageLink[] = [
  { slot: 'panel-foot', href: '/releases', label: 'Releases' },
  { slot: 'panel-foot', href: '/radar', label: 'Radar' },
  { slot: 'panel-foot', href: '/cips', label: 'Proposals' },
  { slot: 'panel-foot', href: '/for-ai', label: 'MCP and API' },
  { slot: 'note', href: '/contact', label: 'Tell us' },
];

export function evidenceFound(body: string, evidence: string): boolean {
  const text = body.replace(/<[^>]+>/g, ' ').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ');
  return new RegExp(evidence, 'i').test(text);
}

export function resourcesBySection(section: ResourceSection): { group: string; links: ResourceLink[] }[] {
  const groups: { group: string; links: ResourceLink[] }[] = [];
  for (const link of RESOURCES.filter(r => r.section === section)) {
    let g = groups.find(x => x.group === link.group);
    if (!g) {
      g = { group: link.group, links: [] };
      groups.push(g);
    }
    g.links.push(link);
  }
  return groups;
}

export function ageInDays(verifiedAt: string, now: number = Date.now()): number {
  return Math.floor((now - Date.parse(`${verifiedAt}T00:00:00Z`)) / 86_400_000);
}
