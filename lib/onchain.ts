/**
 * Live NEAR network state and NEAR market, fetched at call time.
 *
 * Sources (public, no key):
 *   - NEAR mainnet RPC (the endpoints the syncs use, lib/near-sources.ts):
 *     `status` for height, head time, protocol and node version; `block` for
 *     total supply; `validators` for the validator set and its stake.
 *   - CoinGecko simple price: NEAR price, market cap, 24h change.
 *
 * A short in-process cache keeps a burst of calls to one read. RPC has no
 * cheap count of transactions or accounts, so those are not reported, rather
 * than guessed. DeFi TVL is not fetched here (find_project carries it per
 * project).
 */

import { RPC_ENDPOINTS } from './near-sources';

const COINGECKO_NEAR =
  'https://api.coingecko.com/api/v3/simple/price?ids=near&vs_currencies=usd&include_market_cap=true&include_24hr_change=true';

const TTL_MS = 60_000;
const TIMEOUT_MS = 6_000;
const YOCTO = BigInt(10) ** BigInt(24);

export interface OnchainSnapshot {
  fetchedAt: string;
  chain: {
    height: number;
    headTime: string;
    protocolVersion: number;
    nodeVersion: string | null;
    totalSupplyNear: number | null;
    validators: number | null;
    totalStakeNear: number | null;
    epochHeight: number | null;
    endpoint: string;
  } | null;
  market: {
    priceUsd: number | null;
    marketCapUsd: number | null;
    change24hPct: number | null;
  } | null;
  errors: string[];
}

let cache: { at: number; data: OnchainSnapshot } | null = null;

async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json', ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** One RPC call, the mainnet endpoints tried in order; the endpoint that answered comes back with the result. */
export async function mainnetRpc<T>(method: string, params: unknown): Promise<{ result: T; endpoint: string }> {
  let last: unknown = null;
  for (const endpoint of RPC_ENDPOINTS.mainnet) {
    try {
      const body = (await fetchJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'nearpedia', method, params }),
      })) as { result?: T; error?: unknown };
      if (body.error !== undefined || body.result === undefined) throw new Error(`${method}: ${JSON.stringify(body.error).slice(0, 200)}`);
      return { result: body.result, endpoint };
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

const num = (v: unknown): number | null =>
  v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v);

const near = (yocto: string | undefined): number | null => (yocto ? Number(BigInt(yocto) / YOCTO) : null);

interface Status { version?: { version?: string }; protocol_version: number; sync_info: { latest_block_height: number; latest_block_time: string } }
interface Block { header: { total_supply: string } }
interface Validators { current_validators: Array<{ stake: string }>; epoch_height?: number }

async function readChain(errors: string[]): Promise<OnchainSnapshot['chain']> {
  let status: { result: Status; endpoint: string };
  try {
    status = await mainnetRpc<Status>('status', []);
  } catch (e) {
    errors.push(`RPC status failed: ${(e as Error).message}`);
    return null;
  }
  const [block, validators] = await Promise.allSettled([
    mainnetRpc<Block>('block', { finality: 'final' }),
    mainnetRpc<Validators>('validators', [null]),
  ]);
  if (block.status === 'rejected') errors.push(`RPC block failed: ${(block.reason as Error).message}`);
  if (validators.status === 'rejected') errors.push(`RPC validators failed: ${(validators.reason as Error).message}`);
  const set = validators.status === 'fulfilled' ? validators.value.result : null;
  return {
    height: status.result.sync_info.latest_block_height,
    headTime: status.result.sync_info.latest_block_time,
    protocolVersion: status.result.protocol_version,
    nodeVersion: status.result.version?.version ?? null,
    totalSupplyNear: block.status === 'fulfilled' ? near(block.value.result.header.total_supply) : null,
    validators: set ? set.current_validators.length : null,
    totalStakeNear: set ? Number(set.current_validators.reduce((sum, v) => sum + BigInt(v.stake), BigInt(0)) / YOCTO) : null,
    epochHeight: set?.epoch_height ?? null,
    endpoint: status.endpoint,
  };
}

async function readMarket(errors: string[]): Promise<OnchainSnapshot['market']> {
  try {
    const m = ((await fetchJson(COINGECKO_NEAR)) as { near?: Record<string, unknown> })?.near;
    if (!m) {
      errors.push('CoinGecko returned no near entry');
      return null;
    }
    return { priceUsd: num(m.usd), marketCapUsd: num(m.usd_market_cap), change24hPct: num(m.usd_24h_change) };
  } catch (e) {
    errors.push(`CoinGecko fetch failed: ${(e as Error).message}`);
    return null;
  }
}

export async function getOnchainSnapshot(force = false): Promise<OnchainSnapshot> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const errors: string[] = [];
  const [chain, market] = await Promise.all([readChain(errors), readMarket(errors)]);
  const data: OnchainSnapshot = { fetchedAt: new Date().toISOString(), chain, market, errors };
  if (chain || market) cache = { at: Date.now(), data };
  return data;
}
