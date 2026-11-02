import { describe, expect, it } from 'vitest';
import { groupTools } from '@/app/for-ai/tool-groups';
import { MCP_TOOLS_FALLBACK } from '@/app/for-ai/data';
import { CODE_TOOLS, ECOSYSTEM_TOOLS, EVERYONE_TOOLS, PUBLIC_TOOLS, toolFilter } from '@/lib/mcp-toolset';

const tool = (name: string) => ({ name, desc: `${name} description` });

describe('groupTools', () => {
  it('keeps every tool exactly once', () => {
    const names = groupTools(MCP_TOOLS_FALLBACK).flatMap((g) => g.tools.map((t) => t.name));
    expect(names.sort()).toEqual(MCP_TOOLS_FALLBACK.map((t) => t.name).sort());
  });

  it('puts the public tools in the code and ecosystem groups of lib/mcp-toolset.ts', () => {
    const groups = groupTools([tool('check_code'), tool('get_radar'), tool('get_standard')]);
    expect(groups.map((g) => [g.key, g.tools.map((t) => t.name)])).toEqual([['code', ['check_code', 'get_standard']], ['ecosystem', ['get_radar']]]);
  });

  it('sends a tool outside both groups to the last group instead of dropping it', () => {
    const groups = groupTools([tool('check_code'), tool('frobnicate_widget')]);
    expect(groups[groups.length - 1]).toMatchObject({ key: 'other', tools: [{ name: 'frobnicate_widget' }] });
  });

  it('returns nothing for an empty list', () => {
    expect(groupTools([])).toEqual([]);
  });
});

describe('the public tool set', () => {
  it('is twelve code, ten builder and five everyone tools, no tool in two groups, and the fallback list names exactly them', () => {
    expect(CODE_TOOLS).toHaveLength(12);
    expect(ECOSYSTEM_TOOLS).toHaveLength(10);
    expect(EVERYONE_TOOLS).toHaveLength(5);
    expect(PUBLIC_TOOLS.size).toBe(27);
    expect(MCP_TOOLS_FALLBACK.map((t) => t.name).sort()).toEqual([...PUBLIC_TOOLS].sort());
  });

  it('offers every tool only to a scratch server that asks for the full set', () => {
    expect(toolFilter({})('search_talks')).toBe(false);
    expect(toolFilter({})('check_code')).toBe(true);
    expect(toolFilter({ MCP_TOOLSET: 'full' })('search_talks')).toBe(true);
  });
});
