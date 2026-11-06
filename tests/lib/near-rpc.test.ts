import { afterEach, describe, expect, it, vi } from 'vitest';
import { rpcClient } from '@/lib/near-rpc';

afterEach(() => vi.unstubAllGlobals());

const unknownBlock = () => Response.json(
  { jsonrpc: '2.0', id: 'nearpedia', error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_BLOCK', info: {} }, code: -32000, message: 'Server error', data: 'DB Not Found Error: BLOCK HEIGHT: 7' } },
  { status: 422 },
);

describe('rpcClient', () => {
  it('reads an UNKNOWN_BLOCK answered with HTTP 422 as the chain\'s answer, from the first endpoint only', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); return unknownBlock(); }));
    const rpc = rpcClient('testnet', 'test', ['https://a', 'https://b']);
    await expect(rpc.call('block', { block_id: 7 })).rejects.toThrow(/UNKNOWN_BLOCK/);
    expect(urls).toEqual(['https://a']);
  });

  it('moves to the next endpoint when the first fails', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      return url === 'https://a' ? new Response('', { status: 403 }) : Response.json({ jsonrpc: '2.0', id: 'nearpedia', result: { ok: 1 } });
    }));
    const rpc = rpcClient('testnet', 'test', ['https://a', 'https://b']);
    expect(await rpc.call('status', [])).toEqual({ ok: 1 });
    expect(rpc.endpoint()).toBe('https://b');
  });
});
