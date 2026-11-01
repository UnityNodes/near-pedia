import { describe, expect, it } from 'vitest';
import { groupTools } from '@/app/for-ai/tool-groups';
import { MCP_TOOLS_FALLBACK } from '@/app/for-ai/data';

const tool = (name: string) => ({ name, desc: `${name} description` });

describe('groupTools', () => {
  it('keeps every tool exactly once', () => {
    const groups = groupTools(MCP_TOOLS_FALLBACK);
    const names = groups.flatMap(g => g.tools.map(t => t.name));
    expect(names.sort()).toEqual(MCP_TOOLS_FALLBACK.map(t => t.name).sort());
  });

  it('puts CIP tools under governance and search tools under search', () => {
    const groups = groupTools([tool('get_cip'), tool('list_cips'), tool('semantic_search'), tool('search_talks')]);
    expect(groups.find(g => g.key === 'governance')?.tools.map(t => t.name)).toEqual(['get_cip', 'list_cips']);
    expect(groups.find(g => g.key === 'search')?.tools.map(t => t.name)).toEqual(['semantic_search', 'search_talks']);
  });

  it('sends a tool nothing matches to the last group instead of dropping it', () => {
    const groups = groupTools([tool('get_cip'), tool('frobnicate_widget')]);
    expect(groups[groups.length - 1].key).toBe('other');
    expect(groups[groups.length - 1].tools.map(t => t.name)).toEqual(['frobnicate_widget']);
  });

  it('matches whole words, so a name that merely contains one does not move', () => {
    const groups = groupTools([tool('principal_report')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('other');
  });

  it('returns no empty groups and keeps the input order inside a group', () => {
    const groups = groupTools([tool('list_videos'), tool('get_doc'), tool('get_video')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].tools.map(t => t.name)).toEqual(['list_videos', 'get_doc', 'get_video']);
  });

  it('returns nothing for an empty list', () => {
    expect(groupTools([])).toEqual([]);
  });
});
