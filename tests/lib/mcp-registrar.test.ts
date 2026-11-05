import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registrarFor } from '@/lib/mcp-registrar';

function fakeSdk() {
  const registered: Array<{ name: string; config: { annotations?: Record<string, unknown> } }> = [];
  const sdk = {
    registerTool(name: string, config: { annotations?: Record<string, unknown> }) { registered.push({ name, config }); return {}; },
    registerResource() { return {}; },
  };
  return { sdk: sdk as never, registered };
}

describe('tool annotations', () => {
  it('marks every tool read-only and non-destructive, since no NEARpedia tool writes anything', () => {
    const { sdk, registered } = fakeSdk();
    registrarFor(sdk).tool('search', 'Search.', { q: z.string() }, () => ({ content: [] }));
    expect(registered[0].config.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
  });

  it('keeps what a tool declares on top of the defaults', () => {
    const { sdk, registered } = fakeSdk();
    registrarFor(sdk).tool('get_network_state', 'Live.', {}, { openWorldHint: true }, () => ({ content: [] }));
    expect(registered[0].config.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
  });
});
