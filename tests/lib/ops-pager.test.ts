// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { SITE } from '@/lib/site.config';
import { deletePage, hasChannel, pagerChannels, sendPage } from '@/lib/ops-pager';

type Call = { url: string; method: string; body: unknown };

function fakeFetch(reply: (c: Call) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const call = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const r = reply(call);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  };
  return { impl, calls };
}

const DISCORD = 'https://discord.com/api/webhooks/123/secret-token';

describe('pagerChannels', () => {
  it('reads only the OPS_ names, with the shared bot token as the fallback', () => {
    expect(pagerChannels({ OPS_DISCORD_WEBHOOK_URL: DISCORD, TELEGRAM_CHANNEL_ID: 'public' } as unknown as NodeJS.ProcessEnv))
      .toEqual({ discord: DISCORD, slack: undefined, telegramChat: undefined, telegramBot: undefined });
    expect(hasChannel(pagerChannels({} as unknown as NodeJS.ProcessEnv))).toBe(false);
    expect(hasChannel({ telegramChat: '1' })).toBe(false);
  });
});

describe('sendPage', () => {
  it('asks Discord to wait so the message id comes back, and returns it as a ref', async () => {
    const f = fakeFetch(() => ({ status: 200, body: { id: '987654321', channel_id: '5' } }));
    const r = await sendPage(`${SITE.name}: 1 new failure(s)`, { discord: DISCORD }, f.impl);
    expect(r).toEqual({ delivered: true, refs: ['discord:987654321'] });
    expect(f.calls[0].url).toBe(`${DISCORD}?wait=true`);
    expect(f.calls[0].body).toEqual({ content: `${SITE.name}: 1 new failure(s)`, allowed_mentions: { parse: [] } });
  });

  it('returns the Telegram message id as a ref', async () => {
    const f = fakeFetch(() => ({ status: 200, body: { ok: true, result: { message_id: 42 } } }));
    const r = await sendPage('x', { telegramChat: '-100', telegramBot: 'bot-token' }, f.impl);
    expect(r).toEqual({ delivered: true, refs: ['telegram:42'] });
    expect(f.calls[0].body).toMatchObject({ chat_id: '-100', text: 'x' });
  });

  it('reports not delivered when every channel refuses, without throwing', async () => {
    const f = fakeFetch(() => ({ status: 500 }));
    expect(await sendPage('x', { discord: DISCORD, slack: 'https://hooks.slack.com/x' }, f.impl)).toEqual({ delivered: false, refs: [] });
  });

  it('cuts a message to what Discord accepts', async () => {
    const f = fakeFetch(() => ({ status: 200, body: { id: '1' } }));
    await sendPage('y'.repeat(5000), { discord: DISCORD }, f.impl);
    expect((f.calls[0].body as { content: string }).content.length).toBe(1900);
  });
});

describe('deletePage', () => {
  it('deletes a Discord message through the same webhook, and treats an already deleted one as done', async () => {
    const f = fakeFetch(c => ({ status: c.url.endsWith('/messages/111') ? 204 : 404 }));
    expect(await deletePage('discord:111', { discord: DISCORD }, f.impl)).toBe(true);
    expect(f.calls[0]).toMatchObject({ url: `${DISCORD}/messages/111`, method: 'DELETE' });
    expect(await deletePage('discord:222', { discord: DISCORD }, f.impl)).toBe(true);
  });

  it('keeps the ref for a retry when Discord is down', async () => {
    const f = fakeFetch(() => ({ status: 503 }));
    expect(await deletePage('discord:111', { discord: DISCORD }, f.impl)).toBe(false);
  });

  it('deletes a Telegram message', async () => {
    const f = fakeFetch(() => ({ status: 200, body: { ok: true } }));
    expect(await deletePage('telegram:42', { telegramChat: '-100', telegramBot: 'b' }, f.impl)).toBe(true);
    expect(f.calls[0].body).toEqual({ chat_id: '-100', message_id: 42 });
  });

  it('drops a ref for a channel that is no longer configured', async () => {
    const f = fakeFetch(() => ({ status: 200 }));
    expect(await deletePage('discord:1', {}, f.impl)).toBe(true);
    expect(f.calls).toHaveLength(0);
  });
});
