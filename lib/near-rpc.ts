/**
 * A small NEAR JSON-RPC client for the syncs: one request per call (nearcore
 * has no batch requests), the endpoints of a network tried in order, and an
 * RPC-level error returned as an error rather than as a result.
 */

import { politeFetch } from './polite-fetch';
import { RPC_ENDPOINTS, type Network } from './near-sources';

export class RpcError extends Error {
  constructor(readonly method: string, readonly detail: unknown, readonly endpoint: string) {
    super(`${method} on ${endpoint}: ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300)}`);
  }
}

export interface RpcClient {
  call<T>(method: string, params: unknown): Promise<T>;
  /** The endpoint the last successful call used, for the record. */
  endpoint(): string;
}

export function rpcClient(network: Network, userAgent: string, endpoints: readonly string[] = RPC_ENDPOINTS[network]): RpcClient {
  let preferred = 0;
  return {
    endpoint: () => endpoints[preferred],
    async call<T>(method: string, params: unknown): Promise<T> {
      let last: unknown = null;
      for (let k = 0; k < endpoints.length; k++) {
        const i = (preferred + k) % endpoints.length;
        const url = endpoints[i];
        try {
          const r = await politeFetch(url, {
            userAgent,
            method: 'POST',
            body: JSON.stringify({ jsonrpc: '2.0', id: 'nearpedia', method, params }),
            headers: { 'Content-Type': 'application/json' },
            timeoutMs: 15_000,
            budgetMs: 30_000,
            delays: [1_000, 3_000],
          });
          if (r.kind !== 'ok') throw new RpcError(method, r.kind, url);
          const body = (await r.res.json()) as { result?: T; error?: { cause?: { name?: string } } };
          if (body.error !== undefined) {
            const err = new RpcError(method, body.error, url);
            // A height with no block is the chain's answer, not the endpoint's
            // fault; asking the next endpoint only doubles the request.
            if (body.error.cause?.name === 'UNKNOWN_BLOCK') { preferred = i; throw Object.assign(err, { final: true }); }
            throw err;
          }
          preferred = i;
          return body.result as T;
        } catch (e) {
          if ((e as { final?: boolean }).final) throw e;
          last = e;
        }
      }
      throw last instanceof Error ? last : new Error(String(last));
    },
  };
}
