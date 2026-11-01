/**
 * Where the daily database hash is recorded on NEAR, and reading it back.
 * Shared by scripts/anchor-db.ts, which writes, and the REST API, which
 * checks a stored anchor against the chain on request.
 */

import { JsonRpcProvider } from 'near-api-js';
import { RPC_ENDPOINTS } from './near-sources';

export interface AnchorConfig { network: string; rpc: string; account: string; privateKey: string; contract: string }

export interface ChainRecord { date: string; hash: string; tables: number; rows: number; block_height: number; timestamp_ms: number }

export function anchorConfig(env: Readonly<Record<string, string | undefined>> = process.env): AnchorConfig | null {
  const account = env.NEARPEDIA_ANCHOR_ACCOUNT?.trim();
  const privateKey = env.NEARPEDIA_ANCHOR_PRIVATE_KEY?.trim();
  const contract = env.NEARPEDIA_ANCHOR_CONTRACT?.trim();
  if (!account || !privateKey || !contract) return null;
  const network = env.NEARPEDIA_ANCHOR_NETWORK?.trim() || 'mainnet';
  const rpc = env.NEARPEDIA_ANCHOR_RPC?.trim() || RPC_ENDPOINTS[network as keyof typeof RPC_ENDPOINTS]?.[0];
  if (!rpc) throw new Error(`no RPC endpoint known for network ${network}; set NEARPEDIA_ANCHOR_RPC`);
  return { network, rpc, account, privateKey, contract };
}

/** The public RPC of a network this index knows, for reading a record back; null for a local or unknown network. */
export function rpcOf(network: string | null): string | null {
  return network && network in RPC_ENDPOINTS ? RPC_ENDPOINTS[network as keyof typeof RPC_ENDPOINTS][0] : null;
}

export async function chainRecord(rpc: string, contract: string, date: string): Promise<ChainRecord | null> {
  const provider = new JsonRpcProvider({ url: rpc });
  const r = await provider.callFunction({ contractId: contract, method: 'get', args: { date } });
  return r && typeof r === 'object' ? (r as unknown as ChainRecord) : null;
}
