import { parse } from 'yaml';
import { politeFetch } from './polite-fetch';

export async function fetchSpec(url: string, userAgent: string): Promise<unknown | null> {
  const r = await politeFetch(url, { userAgent, timeoutMs: 60_000 });
  if (r.kind !== 'ok') return null;
  const text = await r.res.text();
  return /\.ya?ml$/i.test(new URL(url).pathname) ? parse(text, { maxAliasCount: -1 }) : JSON.parse(text);
}
