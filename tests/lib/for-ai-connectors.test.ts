import { describe, it, expect } from 'vitest';
import { IDE_CONFIGS, MCP_URL } from '@/app/for-ai/data';

const CONNECTOR_TABS = ['Claude.ai', 'ChatGPT'];

describe('connector recipes on /for-ai', () => {
  it.each(CONNECTOR_TABS)('has a %s tab', tab => {
    expect(IDE_CONFIGS.some(c => c.tab === tab)).toBe(true);
  });

  it.each(CONNECTOR_TABS)('%s tab hands over the live MCP url and says no auth', tab => {
    const config = IDE_CONFIGS.find(c => c.tab === tab);
    expect(config?.code).toContain(MCP_URL);
    expect(config?.code).toMatch(/Auth: none/);
  });

  it('lists both connector tabs right after Claude Code so they sit inside the visible tab row', () => {
    const tabs = IDE_CONFIGS.map(c => c.tab);
    expect(tabs.slice(0, 3)).toEqual(['Claude Code', 'Claude.ai', 'ChatGPT']);
  });

  it('keeps every tab name unique so the tab list has one key per client', () => {
    const tabs = IDE_CONFIGS.map(c => c.tab);
    expect(new Set(tabs).size).toBe(tabs.length);
  });
});
