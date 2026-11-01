export interface PagerChannels {
  discord?: string;
  slack?: string;
  telegramChat?: string;
  telegramBot?: string;
}

export interface PageResult {
  delivered: boolean;
  refs: string[];
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;
const MAX_CHARS = 1900;
const TELEGRAM_API = 'https://api.telegram.org';

export function pagerChannels(env: NodeJS.ProcessEnv = process.env): PagerChannels {
  return {
    discord: env.OPS_DISCORD_WEBHOOK_URL || undefined,
    slack: env.OPS_SLACK_WEBHOOK_URL || undefined,
    telegramChat: env.OPS_TELEGRAM_CHAT_ID || undefined,
    telegramBot: env.OPS_TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || undefined,
  };
}

export function hasChannel(c: PagerChannels): boolean {
  return Boolean(c.discord || c.slack || (c.telegramChat && c.telegramBot));
}

function discordUrl(webhook: string, suffix: string, wait: boolean): string {
  const url = new URL(webhook);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${suffix}`;
  if (wait) url.searchParams.set('wait', 'true');
  return url.toString();
}

async function call(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response | null> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return null;
  }
}

export async function sendPage(text: string, channels: PagerChannels = pagerChannels(), fetchImpl: FetchLike = fetch): Promise<PageResult> {
  const content = text.slice(0, MAX_CHARS);
  const refs: string[] = [];
  let delivered = false;
  const json = { 'Content-Type': 'application/json' };

  if (channels.discord) {
    const res = await call(fetchImpl, discordUrl(channels.discord, '', true), {
      method: 'POST', headers: json, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
    if (res?.ok) {
      delivered = true;
      const id = ((await res.json().catch(() => ({}))) as { id?: unknown }).id;
      if (typeof id === 'string' && /^\d+$/.test(id)) refs.push(`discord:${id}`);
    } else {
      console.error(`[ops-pager] discord send failed${res ? ` (HTTP ${res.status})` : ''}`);
    }
  }

  if (channels.slack) {
    const res = await call(fetchImpl, channels.slack, { method: 'POST', headers: json, body: JSON.stringify({ text: content }) });
    if (res?.ok) delivered = true;
    else console.error(`[ops-pager] slack send failed${res ? ` (HTTP ${res.status})` : ''}`);
  }

  if (channels.telegramChat && channels.telegramBot) {
    const res = await call(fetchImpl, `${TELEGRAM_API}/bot${channels.telegramBot}/sendMessage`, {
      method: 'POST', headers: json,
      body: JSON.stringify({ chat_id: channels.telegramChat, text: content, disable_web_page_preview: true }),
    });
    if (res?.ok) {
      delivered = true;
      const id = ((await res.json().catch(() => ({}))) as { result?: { message_id?: unknown } }).result?.message_id;
      if (typeof id === 'number') refs.push(`telegram:${id}`);
    } else {
      console.error(`[ops-pager] telegram send failed${res ? ` (HTTP ${res.status})` : ''}`);
    }
  }

  return { delivered, refs };
}

export async function deletePage(ref: string, channels: PagerChannels = pagerChannels(), fetchImpl: FetchLike = fetch): Promise<boolean> {
  const [channel, id] = ref.split(':');
  if (channel === 'discord' && channels.discord && /^\d+$/.test(id ?? '')) {
    const res = await call(fetchImpl, discordUrl(channels.discord, `/messages/${id}`, false), { method: 'DELETE' });
    return res !== null && (res.ok || res.status === 404);
  }
  if (channel === 'telegram' && channels.telegramChat && channels.telegramBot && /^\d+$/.test(id ?? '')) {
    const res = await call(fetchImpl, `${TELEGRAM_API}/bot${channels.telegramBot}/deleteMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: channels.telegramChat, message_id: Number(id) }),
    });
    return res !== null && (res.ok || res.status === 400);
  }
  return true;
}
