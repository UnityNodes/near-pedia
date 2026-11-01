import type { ToolItem } from './data';

export interface ToolGroup {
  key: string;
  title: string;
  blurb: string;
  tools: ToolItem[];
}

interface GroupRule {
  key: string;
  title: string;
  blurb: string;
  words: string[];
}

const RULES: GroupRule[] = [
  {
    key: 'governance',
    title: 'Governance',
    blurb: 'Proposals, their history, attachments and dependency chains.',
    words: ['cip', 'proposal', 'governance', 'vote'],
  },
  {
    key: 'search',
    title: 'Search',
    blurb: 'Keyword and meaning-based search across every source.',
    words: ['search', 'semantic'],
  },
  {
    key: 'network',
    title: 'Network',
    blurb: 'Live network state, trending content and recent activity.',
    words: ['network', 'trending', 'recent'],
  },
  {
    key: 'community',
    title: 'Community',
    blurb: 'Forum threads, GitHub discussions and who to ask.',
    words: ['discussion', 'forum', 'maintainer', 'expert', 'collaboration', 'thread', 'mail'],
  },
  {
    key: 'learn',
    title: 'Learn',
    blurb: 'Docs, whitepapers, talks, blog posts and guided onboarding.',
    words: ['doc', 'whitepaper', 'video', 'blog', 'talk', 'foundation', 'started', 'learning', 'glossary', 'guide', 'digest'],
  },
  {
    key: 'build',
    title: 'Build',
    blurb: 'Releases, changelogs, repositories, known issues and ecosystem projects.',
    words: [
      'release', 'changelog', 'breaking', 'repo', 'code', 'sdk', 'issue', 'patch', 'drift', 'error',
      'ecosystem', 'project', 'radar', 'dependency', 'graph', 'example', 'security',
    ],
  },
];

const OTHER: Omit<GroupRule, 'words'> = {
  key: 'other',
  title: 'More tools',
  blurb: 'Everything else the server offers.',
};

function stem(word: string): string {
  return word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

function ruleFor(name: string): Omit<GroupRule, 'words'> {
  const parts = new Set(name.toLowerCase().split('_').map(stem));
  const hit = RULES.find(rule => rule.words.some(word => parts.has(stem(word))));
  return hit ?? OTHER;
}

export function groupTools(tools: ToolItem[]): ToolGroup[] {
  const order = [...RULES.map(rule => rule.key), OTHER.key];
  const byKey = new Map<string, ToolGroup>();
  for (const tool of tools) {
    const rule = ruleFor(tool.name);
    const group = byKey.get(rule.key) ?? { key: rule.key, title: rule.title, blurb: rule.blurb, tools: [] };
    byKey.set(rule.key, { ...group, tools: [...group.tools, tool] });
  }
  return order.flatMap(key => {
    const group = byKey.get(key);
    return group ? [group] : [];
  });
}
