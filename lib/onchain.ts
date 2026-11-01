/**
 * lib/onchain.ts — LIVE YourChain on-chain state + TKN market.
 *
 * Sources (all public, no key):
 *   - Explorer mainnet indexer  https://api.explorer.example/v1/head
 *       → block height, validators, TKN supply, cumulative data size, txs, accounts, contracts
 *   - CoinGecko simple price     https://api.coingecko.com/api/v3/simple/price?ids=yourchain
 *       → TKN price, market cap, 24h change
 *
 * Fetched live at call time with a short in-process cache, so the MCP/REST layer
 * returns real on-chain context without storing or scheduling anything. DeFi TVL
 * is not fetched here, so it is omitted deliberately rather than faked.
 */

const EXPLORER_HEAD = 'https://api.explorer.example/v1/head';
const EXPLORER_VALIDATORS = 'https://api.explorer.example/v1/validators';
const COINGECKO_TKN =
  'https://api.coingecko.com/api/v3/simple/price?ids=yourchain&vs_currencies=usd&include_market_cap=true&include_24hr_change=true';

const TTL_MS = 60_000;
const TIMEOUT_MS = 6_000;

export interface OnchainSnapshot {
  fetchedAt: string;
  chain: {
    height: number | null;
    headTime: string | null;
    totalValidators: number | null;
    totalSupplyTkn: number | null;
    totalDataSizeBytes: number | null;
    totalTx: number | null;
    totalAccounts: number | null;
    totalContracts: number | null;
  } | null;
  market: {
    priceUsd: number | null;
    marketCapUsd: number | null;
    change24hPct: number | null;
  } | null;
  errors: string[];
}

let cache: { at: number; data: OnchainSnapshot } | null = null;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const num = (v: unknown): number | null =>
  v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v);

export async function getOnchainSnapshot(force = false): Promise<OnchainSnapshot> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const errors: string[] = [];
  const [headRes, mktRes] = await Promise.allSettled([
    fetchJson(EXPLORER_HEAD),
    fetchJson(COINGECKO_TKN),
  ]);

  let chain: OnchainSnapshot['chain'] = null;
  if (headRes.status === 'fulfilled') {
    const h = headRes.value as Record<string, unknown>;
    chain = {
      height: num(h.last_height),
      headTime: typeof h.last_time === 'string' ? h.last_time : null,
      totalValidators: num(h.total_validators),
      totalSupplyTkn: h.total_supply != null ? Number(h.total_supply) / 1e6 : null,
      totalDataSizeBytes: num(h.total_data_size),
      totalTx: num(h.total_tx),
      totalAccounts: num(h.total_accounts),
      totalContracts: num(h.total_contracts),
    };
  } else {
    errors.push(`Explorer head fetch failed: ${headRes.reason?.message ?? headRes.reason}`);
  }

  let market: OnchainSnapshot['market'] = null;
  if (mktRes.status === 'fulfilled') {
    const m = (mktRes.value as { yourchain?: Record<string, unknown> })?.yourchain;
    if (m) {
      market = {
        priceUsd: num(m.usd),
        marketCapUsd: num(m.usd_market_cap),
        change24hPct: num(m.usd_24h_change),
      };
    } else {
      errors.push('CoinGecko returned no yourchain entry');
    }
  } else {
    errors.push(`CoinGecko fetch failed: ${mktRes.reason?.message ?? mktRes.reason}`);
  }

  const data: OnchainSnapshot = {
    fetchedAt: new Date().toISOString(),
    chain,
    market,
    errors,
  };
  // Only cache a fully/partly successful read; on total failure keep any prior
  // good snapshot rather than poisoning the cache with an all-null result.
  if (chain || market) cache = { at: Date.now(), data };
  return data;
}

export interface ValidatorRow {
  moniker: string;
  website: string | null;
  valoperAddress: string | null;
  votingPower: number | null;   // TKN
  commissionRate: number | null; // 0..1
  jailed: boolean;
}

export interface ValidatorStats {
  /** Everything in the registry, including jailed and idle. */
  registered: number;
  /** Not jailed AND carrying voting power - the set actually securing the chain. */
  active: number;
  jailed: number;
  /** Active validators, strongest first. */
  rows: ValidatorRow[];
}

let validatorCache: { at: number; data: ValidatorStats } | null = null;

const EMPTY_STATS: ValidatorStats = { registered: 0, active: 0, jailed: 0, rows: [] };

/**
 * Live YourChain validator set from the Explorer indexer.
 *
 * Explorer's /head reports `total_validators`, which is the size of the whole
 * REGISTRY, which includes jailed validators and ones that carry no voting
 * power. Labelling that number "active validators" overstates the set securing
 * the chain, so we page through the registry and count the
 * validators that are neither jailed nor powerless.
 *
 * Returns zeroed stats on failure so a caller can hide the section rather than
 * render a half-empty table.
 */
export async function getValidatorStats(force = false): Promise<ValidatorStats> {
  if (!force && validatorCache && Date.now() - validatorCache.at < TTL_MS) {
    return validatorCache.data;
  }
  try {
    const page = 100;      // Explorer caps a page at 100
    const maxPages = 8;    // 800 validators of headroom over the registry size
    const all: Array<Record<string, unknown>> = [];
    for (let i = 0; i < maxPages; i++) {
      const url = `${EXPLORER_VALIDATORS}?limit=${page}&offset=${i * page}&sort=voting_power&order=desc`;
      const raw = (await fetchJson(url)) as Array<Record<string, unknown>>;
      if (!Array.isArray(raw) || raw.length === 0) break;
      all.push(...raw);
      if (raw.length < page) break;
    }
    if (all.length === 0) return validatorCache?.data ?? EMPTY_STATS;

    const toRow = (v: Record<string, unknown>): ValidatorRow => ({
      moniker: String(v.moniker ?? '').trim() || 'unnamed validator',
      website: typeof v.website === 'string' && v.website.trim() ? v.website.trim() : null,
      valoperAddress:
        typeof v.address === 'object' && v.address !== null
          ? String((v.address as { hash?: unknown }).hash ?? '') || null
          : null,
      votingPower: num(v.voting_power),
      commissionRate: num(v.rate),
      jailed: v.jailed === true,
    });

    const isActive = (v: Record<string, unknown>) =>
      v.jailed !== true && (num(v.voting_power) ?? 0) > 0;

    const data: ValidatorStats = {
      registered: all.length,
      active: all.filter(isActive).length,
      jailed: all.filter((v) => v.jailed === true).length,
      rows: all.filter(isActive).map(toRow),
    };
    validatorCache = { at: Date.now(), data };
    return data;
  } catch (err) {
    console.warn('[onchain] validator fetch failed:', err instanceof Error ? err.message : err);
    return validatorCache?.data ?? EMPTY_STATS;
  }
}

/** Human-readable byte size, e.g. 4.29 TB. */
export function formatBytes(n: number | null): string {
  if (n == null) return 'n/a';
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)} TB`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)} KB`;
  return `${n} B`;
}
