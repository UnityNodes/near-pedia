/**
 * get_contract_info: what is deployed on a NEAR account, read live from RPC.
 *
 * The method list comes from the wasm's own export section, not from an
 * ABI: most contracts on mainnet ship none. Standards come from the
 * contract's NEP-330 source metadata when it has it, otherwise they are
 * inferred from the methods it exports, and the answer says which.
 *
 * Read live, never stored: a contract can be redeployed at any block.
 */

import { rpcClient, type RpcClient } from './near-rpc';
import type { Network } from './near-sources';

export interface AccountView { amount: string; locked: string; code_hash: string; storage_usage: number; block_height: number; global_contract_hash?: string | null; global_contract_account_id?: string | null }

/** A view call's outcome: the method answered, the contract has no such method, or the read itself failed. */
type Read<T> = { ok: true; value: T | null } | { ok: false };

export interface SourceMetadata { version?: string | null; link?: string | null; standards?: Array<{ standard: string; version: string }>; build_info?: { build_environment?: string; source_code_snapshot?: string; contract_path?: string | null; build_command?: string[] } | null }

export interface ContractInfo {
  account_id: string;
  network: Network;
  block_height: number;
  balance_near: string;
  locked_near: string;
  storage_bytes: number;
  code_hash: string | null;
  code_bytes: number | null;
  methods: string[];
  /** Exports dropped because their names are not identifiers: the deployer chooses those bytes. */
  odd_exports: number;
  /** The account runs a global contract (NEP-591) deployed elsewhere. */
  global_contract: string | null;
  source: SourceMetadata | null;
  /** Reads that failed, so what they would have said is unknown rather than absent. */
  unread: string[];
  standards: Array<{ standard: string; version: string | null; from: 'nep330' | 'exports' }>;
  token: { kind: 'ft' | 'nft'; name: string | null; symbol: string | null; decimals: number | null } | null;
}

const EMPTY_CODE = '11111111111111111111111111111111';

const yoctoToNear = (y: string) => {
  const v = BigInt(y);
  const whole = v / BigInt('1000000000000000000000000');
  const frac = (v % BigInt('1000000000000000000000000')).toString().padStart(24, '0').slice(0, 4);
  return `${whole.toString()}.${frac}`;
};

/** A method name worth printing: an identifier, not whatever bytes a deployer put in the export section. */
const METHOD_NAME = /^[A-Za-z_$][\w$]{0,127}$/;
export const MAX_METHODS = 2000;

/**
 * Function names a wasm module exports: section 7, one entry per export,
 * kind 0 = function. Names are the deployer's bytes: anything that is not
 * an identifier is counted and dropped, so a 3 MB export name cannot become
 * a 3 MB answer.
 */
export function wasmExports(wasm: Uint8Array): { methods: string[]; dropped: number } {
  if (wasm.length < 8 || wasm[0] !== 0 || wasm[1] !== 0x61 || wasm[2] !== 0x73 || wasm[3] !== 0x6d) throw new Error('not a wasm module');
  let p = 8;
  const leb = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (p >= wasm.length) throw new Error('truncated wasm');
      const b = wasm[p++];
      result += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) return result;
      shift += 7;
      if (shift > 35) throw new Error('bad LEB128');
    }
  };
  while (p < wasm.length) {
    const id = wasm[p++];
    const size = leb();
    const end = p + size;
    if (end > wasm.length) throw new Error('truncated wasm section');
    if (id === 7) {
      const out: string[] = [];
      let dropped = 0;
      const n = leb();
      for (let i = 0; i < n; i++) {
        const len = leb();
        if (p + len > end) throw new Error('truncated wasm export');
        const name = len <= 128 ? new TextDecoder().decode(wasm.subarray(p, p + len)) : '';
        p += len;
        const kind = wasm[p++];
        leb();
        if (kind !== 0) continue;
        if (METHOD_NAME.test(name) && out.length < MAX_METHODS) out.push(name);
        else dropped++;
      }
      return { methods: out.sort(), dropped };
    }
    p = end;
  }
  return { methods: [], dropped: 0 };
}

/** Standards a method set implements, by the methods each standard requires. */
const BY_METHODS: Array<{ standard: string; version: string | null; all: string[] }> = [
  { standard: 'nep141', version: null, all: ['ft_transfer', 'ft_transfer_call', 'ft_balance_of', 'ft_total_supply'] },
  { standard: 'nep148', version: null, all: ['ft_metadata'] },
  { standard: 'nep145', version: null, all: ['storage_deposit', 'storage_balance_of'] },
  { standard: 'nep171', version: null, all: ['nft_transfer', 'nft_transfer_call', 'nft_token'] },
  { standard: 'nep177', version: null, all: ['nft_metadata'] },
  { standard: 'nep178', version: null, all: ['nft_approve', 'nft_revoke'] },
  { standard: 'nep181', version: null, all: ['nft_tokens', 'nft_supply_for_owner'] },
  { standard: 'nep199', version: null, all: ['nft_payout'] },
  { standard: 'nep245', version: null, all: ['mt_transfer', 'mt_balance_of'] },
  { standard: 'nep330', version: null, all: ['contract_source_metadata'] },
];

export function standardsFromMethods(methods: readonly string[]): Array<{ standard: string; version: null; from: 'exports' }> {
  const has = new Set(methods);
  return BY_METHODS.filter((s) => s.all.every((m) => has.has(m))).map((s) => ({ standard: s.standard, version: null, from: 'exports' as const }));
}

async function view<T>(rpc: RpcClient, account_id: string, method_name: string): Promise<Read<T>> {
  try {
    const r = await rpc.call<{ result?: number[]; error?: string }>('query', { request_type: 'call_function', finality: 'final', account_id, method_name, args_base64: Buffer.from('{}').toString('base64') });
    if (!r.result) return { ok: true, value: null };
    return { ok: true, value: JSON.parse(Buffer.from(r.result).toString('utf8')) as T };
  } catch {
    return { ok: false };
  }
}

const CACHE_MS = 60_000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; info: ContractInfo }>();

export const ACCOUNT_ID_RE = /^(?=.{2,64}$)(?:[a-z\d]+[-_])*[a-z\d]+(?:\.(?:[a-z\d]+[-_])*[a-z\d]+)*$/;

export class NoSuchAccountError extends Error {}

/**
 * Cached a minute per account: each answer costs two to five RPC calls,
 * one of them the whole wasm, and the endpoints are public. A failed read
 * is not cached.
 */
export async function contractInfo(accountId: string, network: Network, userAgent: string, rpc?: RpcClient): Promise<ContractInfo> {
  const key = `${network}:${accountId}`;
  const hit = cache.get(key);
  if (!rpc && hit && Date.now() - hit.at < CACHE_MS) return hit.info;
  const info = await readContract(accountId, network, rpc ?? rpcClient(network, userAgent));
  if (!rpc && info.unread.length === 0) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), info });
  }
  return info;
}

async function readContract(accountId: string, network: Network, rpc: RpcClient): Promise<ContractInfo> {
  let acct: AccountView;
  try {
    acct = await rpc.call<AccountView>('query', { request_type: 'view_account', finality: 'final', account_id: accountId });
  } catch (e) {
    if (/UNKNOWN_ACCOUNT|does not exist/i.test((e as Error).message)) throw new NoSuchAccountError(`${accountId} does not exist on ${network}`);
    throw e;
  }
  const info: ContractInfo = {
    account_id: accountId, network, block_height: acct.block_height,
    balance_near: yoctoToNear(acct.amount), locked_near: yoctoToNear(acct.locked), storage_bytes: acct.storage_usage,
    code_hash: acct.code_hash === EMPTY_CODE ? null : acct.code_hash, code_bytes: null, methods: [], odd_exports: 0,
    global_contract: acct.global_contract_account_id ?? acct.global_contract_hash ?? null, source: null, unread: [], standards: [], token: null,
  };
  if (!info.code_hash && !info.global_contract) return info;
  try {
    const code = await rpc.call<{ code_base64: string }>('query', { request_type: 'view_code', finality: 'final', account_id: accountId });
    const wasm = Buffer.from(code.code_base64, 'base64');
    info.code_bytes = wasm.length;
    const ex = wasmExports(wasm);
    info.methods = ex.methods;
    info.odd_exports = ex.dropped;
  } catch {
    info.unread.push('code');
  }
  const has = new Set(info.methods);
  if (has.has('contract_source_metadata')) {
    const r = await view<SourceMetadata>(rpc, accountId, 'contract_source_metadata');
    if (r.ok) info.source = r.value && typeof r.value === 'object' ? r.value : null;
    else info.unread.push('source metadata');
  }
  const listed = Array.isArray(info.source?.standards) ? info.source!.standards : [];
  const declared = listed
    .filter((s) => s && typeof s.standard === 'string' && s.standard.length <= 32)
    .map((s) => ({ standard: s.standard.toLowerCase(), version: typeof s.version === 'string' ? s.version.slice(0, 32) : null, from: 'nep330' as const }));
  // Declared and inferred together: token.rhealab.near declares only nep330
  // in its metadata while it exports the whole NEP-141 interface.
  const named = new Set(declared.map((s) => s.standard));
  info.standards = [...declared, ...standardsFromMethods(info.methods).filter((s) => !named.has(s.standard))];
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200) : null);
  if (has.has('ft_metadata')) {
    const r = await view<{ name?: unknown; symbol?: unknown; decimals?: unknown }>(rpc, accountId, 'ft_metadata');
    if (!r.ok) info.unread.push('token metadata');
    else if (r.value) info.token = { kind: 'ft', name: str(r.value.name), symbol: str(r.value.symbol), decimals: typeof r.value.decimals === 'number' ? r.value.decimals : null };
  } else if (has.has('nft_metadata')) {
    const r = await view<{ name?: unknown; symbol?: unknown }>(rpc, accountId, 'nft_metadata');
    if (!r.ok) info.unread.push('token metadata');
    else if (r.value) info.token = { kind: 'nft', name: str(r.value.name), symbol: str(r.value.symbol), decimals: null };
  }
  return info;
}

/** Contract-reported text (metadata, token names) is the deployer's own words: through the caller's fence. */
export function renderContract(c: ContractInfo, fence: (s: string) => string, extra: { partner?: string | null; project?: string | null; deprecations?: string[] } = {}): string {
  const lines = [
    `${c.account_id} on ${c.network} at block ${c.block_height}: balance ${c.balance_near} NEAR${c.locked_near !== '0.0000' ? `, ${c.locked_near} staked` : ''}, ${c.storage_bytes.toLocaleString('en')} bytes of storage`,
  ];
  if (!c.code_hash && !c.global_contract) {
    lines.push('No contract deployed: a plain account.');
    return lines.join('\n');
  }
  if (c.global_contract) lines.push(`Runs a global contract (NEP-591): ${fence(c.global_contract)}`);
  lines.push(`Contract: ${c.code_hash ? `code hash ${c.code_hash}, ` : ''}${c.code_bytes !== null ? `${(c.code_bytes / 1024).toFixed(1)} KB, ` : ''}${c.methods.length} exported methods${c.odd_exports ? ` (and ${c.odd_exports} export(s) whose names are not identifiers, not shown)` : ''}`);
  if (c.unread.length) lines.push(`Could not be read just now: ${c.unread.join(', ')}. What they would say is unknown, not absent.`);
  if (c.source) {
    const b = c.source.build_info;
    lines.push(`Source metadata (NEP-330): ${[c.source.version && `version ${fence(c.source.version)}`, c.source.link && `source ${fence(c.source.link)}`, b?.source_code_snapshot && `snapshot ${fence(b.source_code_snapshot)}`, b?.build_environment && `built in ${fence(b.build_environment)}`].filter(Boolean).join(', ') || 'present, empty'}`);
  } else if (!c.unread.includes('source metadata')) lines.push('No NEP-330 source metadata: the deployed code does not say where its source is.');
  const declared = c.standards.filter((s) => s.from === 'nep330');
  const inferred = c.standards.filter((s) => s.from === 'exports');
  const label = (s: ContractInfo['standards'][number]) => fence(`${s.standard.toUpperCase()}${s.version ? ` ${s.version}` : ''}`);
  if (declared.length) lines.push(`Standards declared in its source metadata: ${declared.map(label).join(', ')}`);
  if (inferred.length) lines.push(`Standards inferred from the methods it exports: ${inferred.map(label).join(', ')}`);
  if (c.token) lines.push(`${c.token.kind === 'ft' ? 'Fungible token' : 'NFT collection'}: ${fence(c.token.name ?? '?')} (${fence(c.token.symbol ?? '?')})${c.token.decimals !== null ? `, ${c.token.decimals} decimals` : ''}`);
  if (extra.partner) lines.push(`NEAR partner contract: ${extra.partner} (get_partner)`);
  if (extra.project) lines.push(`NEAR Catalog project: ${fence(extra.project)} (find_project)`);
  for (const d of extra.deprecations ?? []) lines.push(`Deprecation entry: ${fence(d)} (check_deprecation)`);
  const shown = c.methods.slice(0, 120);
  if (shown.length) lines.push(`Methods: ${fence(shown.join(', '))}${c.methods.length > shown.length ? ` … and ${c.methods.length - shown.length} more` : ''}`);
  return lines.join('\n');
}
