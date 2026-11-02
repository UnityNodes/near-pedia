import type { ToolItem } from './data';
import { CODE_TOOLS, ECOSYSTEM_TOOLS, EVERYONE_TOOLS } from '@/lib/mcp-toolset';

export interface ToolGroup {
  key: string;
  title: string;
  blurb: string;
  tools: ToolItem[];
}

/** The two groups lib/mcp-toolset.ts defines, so the page and the registration cannot disagree. */
const GROUPS: Array<Omit<ToolGroup, 'tools'> & { names: readonly string[] }> = [
  { key: 'code', title: 'For code', blurb: 'Is this API, package or version still current, what broke, what an error means, what a standard says.', names: CODE_TOOLS },
  { key: 'ecosystem', title: 'For builders', blurb: 'What is changing now, governance votes and the forum debate behind them, incidents, projects, partners and contracts.', names: ECOSYSTEM_TOOLS },
  { key: 'everyone', title: 'For everyone', blurb: 'NEAR right now: price, supply, validators and where to stake, the latest news and videos.', names: EVERYONE_TOOLS },
];

const OTHER = { key: 'other', title: 'More tools', blurb: 'Everything else the server offers.' };

export function groupTools(tools: ToolItem[]): ToolGroup[] {
  const groupOf = (name: string) => GROUPS.find((g) => g.names.includes(name)) ?? OTHER;
  const order = [...GROUPS.map((g) => g.key), OTHER.key];
  const byKey = new Map<string, ToolGroup>();
  for (const tool of tools) {
    const g = groupOf(tool.name);
    const group = byKey.get(g.key) ?? { key: g.key, title: g.title, blurb: g.blurb, tools: [] };
    byKey.set(g.key, { ...group, tools: [...group.tools, tool] });
  }
  return order.flatMap((key) => {
    const group = byKey.get(key);
    return group ? [group] : [];
  });
}
