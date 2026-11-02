/**
 * NEAR mainnet validators, read live from RPC `validators`: who validates
 * this epoch, with how much stake, and how much of the work assigned to them
 * they did (blocks, chunks and chunk endorsements produced against expected).
 * The version each one announces for the protocol upgrade comes from the
 * block authors sampled by sync-protocol (validator_votes). For one pool its
 * fee is read live from the pool contract (`get_reward_fee_fraction`), and
 * whether it was kicked out of the last epoch, and why, from the same RPC
 * answer.
 *
 * This is the answer to "who are the biggest validators" and "is this pool
 * reliable", which the protocol tools only show in aggregate.
 */

import type Database from 'better-sqlite3';
import { mainnetRpc } from './onchain';

const YOCTO = BigInt(10) ** BigInt(24);

interface RpcValidator {
  account_id: string;
  stake: string;
  is_slashed?: boolean;
  num_produced_blocks?: number; num_expected_blocks?: number;
  num_produced_chunks?: number; num_expected_chunks?: number;
  num_produced_endorsements?: number; num_expected_endorsements?: number;
}
interface RpcValidators {
  current_validators: RpcValidator[];
  epoch_height: number;
  prev_epoch_kickout?: Array<{ account_id: string; reason: unknown }>;
}

export interface ValidatorLine {
  rank: number;
  account_id: string;
  stake_near: number;
  share: number;
  /** Produced over expected blocks, chunks and endorsements this epoch; null before any work was assigned. */
  uptime: number | null;
  slashed: boolean;
  voted_version: number | null;
}

export interface ValidatorsReport {
  epoch_height: number;
  total_stake_near: number;
  lines: ValidatorLine[];
  kicked_out: Array<{ account_id: string; reason: string }>;
  endpoint: string;
  /** The epoch the upgrade votes were sampled in, when it is not this one. */
  votes_epoch: number | null;
}

const near = (yocto: bigint): number => Number(yocto / YOCTO);

export function uptimeOf(v: RpcValidator): number | null {
  const produced = (v.num_produced_blocks ?? 0) + (v.num_produced_chunks ?? 0) + (v.num_produced_endorsements ?? 0);
  const expected = (v.num_expected_blocks ?? 0) + (v.num_expected_chunks ?? 0) + (v.num_expected_endorsements ?? 0);
  return expected > 0 ? produced / expected : null;
}

/** The kickout reason as nearcore sends it: a string ("Unstaked") or a one-key object ({"NotEnoughBlocks": {...}}). */
export function kickoutReason(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  if (reason && typeof reason === 'object') {
    const [k, v] = Object.entries(reason as Record<string, unknown>)[0] ?? [];
    if (!k) return 'unknown';
    if (v && typeof v === 'object' && 'produced' in v && 'expected' in v) return `${k} (${(v as { produced: number }).produced} of ${(v as { expected: number }).expected} expected)`;
    return k;
  }
  return 'unknown';
}

export function buildReport(set: RpcValidators, votes: ReadonlyMap<string, number>, endpoint: string, votesEpoch: number | null = null): ValidatorsReport {
  const sorted = [...set.current_validators].sort((a, b) => (BigInt(b.stake) > BigInt(a.stake) ? 1 : BigInt(b.stake) < BigInt(a.stake) ? -1 : 0));
  const total = sorted.reduce((s, v) => s + BigInt(v.stake), BigInt(0));
  return {
    epoch_height: set.epoch_height,
    total_stake_near: near(total),
    lines: sorted.map((v, i) => ({
      rank: i + 1,
      account_id: v.account_id,
      stake_near: near(BigInt(v.stake)),
      share: total > BigInt(0) ? Number((BigInt(v.stake) * BigInt(1_000_000)) / total) / 1_000_000 : 0,
      uptime: uptimeOf(v),
      slashed: v.is_slashed === true,
      voted_version: votes.get(v.account_id) ?? null,
    })),
    kicked_out: (set.prev_epoch_kickout ?? []).map((k) => ({ account_id: k.account_id, reason: kickoutReason(k.reason) })),
    endpoint,
    votes_epoch: votesEpoch !== null && votesEpoch !== set.epoch_height ? votesEpoch : null,
  };
}

/** The version each validator announced in the latest epoch sync-protocol sampled, and that epoch. */
function latestVotes(db: Database.Database): { votes: Map<string, number>; epoch: number | null } {
  try {
    const snap = db.prepare("SELECT epoch_id, epoch_height FROM protocol_snapshots WHERE network = 'mainnet' ORDER BY observed_at DESC LIMIT 1").get() as { epoch_id: string; epoch_height: number | null } | undefined;
    if (!snap) return { votes: new Map(), epoch: null };
    const rows = db.prepare("SELECT account_id, voted_version FROM validator_votes WHERE network = 'mainnet' AND epoch_id = ?").all(snap.epoch_id) as Array<{ account_id: string; voted_version: number }>;
    return { votes: new Map(rows.map((r) => [r.account_id, r.voted_version])), epoch: snap.epoch_height };
  } catch {
    return { votes: new Map(), epoch: null };
  }
}

export async function readValidators(db: Database.Database): Promise<ValidatorsReport> {
  const { result, endpoint } = await mainnetRpc<RpcValidators>('validators', [null]);
  const { votes, epoch } = latestVotes(db);
  return buildReport(result, votes, endpoint, epoch);
}

/** A staking pool's fee, from its contract; null when the account is not a standard pool. */
export async function poolFee(accountId: string): Promise<number | null> {
  try {
    const { result } = await mainnetRpc<{ result: number[] }>('query', {
      request_type: 'call_function', finality: 'final', account_id: accountId, method_name: 'get_reward_fee_fraction', args_base64: 'e30=',
    });
    const f = JSON.parse(Buffer.from(result.result).toString('utf8')) as { numerator: number; denominator: number };
    return f.denominator > 0 ? f.numerator / f.denominator : null;
  } catch {
    return null;
  }
}

const pct = (x: number, d = 2) => `${(100 * x).toFixed(d)}%`;
const n = (x: number) => x.toLocaleString('en-US');

export function renderValidators(r: ValidatorsReport, opts: { limit: number; account?: string; fee?: number | null; latest_version?: number | null }): string {
  const head = `NEAR mainnet, epoch ${r.epoch_height}: ${r.lines.length} validators, ${n(r.total_stake_near)} NEAR staked with them (live from ${r.endpoint}).`;
  const when = r.votes_epoch !== null ? ` in epoch ${r.votes_epoch}` : '';
  const vote = (l: ValidatorLine) => l.voted_version === null ? 'vote not sampled' : `announced protocol ${l.voted_version}${when}${opts.latest_version && l.voted_version >= opts.latest_version ? ' (the newest)' : ''}`;
  if (opts.account) {
    const want = opts.account.trim().toLowerCase();
    const l = r.lines.find((x) => x.account_id === want);
    const kicked = r.kicked_out.find((k) => k.account_id === want);
    if (!l) {
      return [head, '', `${want} is not in this epoch's validator set.${kicked ? ` It was kicked out of the previous epoch: ${kicked.reason}.` : ''}`,
        'A pool can still hold delegated NEAR while out of the set, but it earns no rewards until it is back in. get_contract_info shows what the account is.'].join('\n');
    }
    return [
      head, '',
      `## ${l.account_id}`,
      `Rank ${l.rank} of ${r.lines.length} by stake: ${n(l.stake_near)} NEAR, ${pct(l.share)} of all stake.`,
      `Work done this epoch: ${l.uptime === null ? 'none assigned yet' : `${pct(l.uptime)} of the blocks, chunks and endorsements expected of it`}.${l.slashed ? ' SLASHED.' : ''}`,
      opts.fee != null ? `Pool fee: ${pct(opts.fee, 1)} of rewards (read from the pool contract).` : 'Pool fee: not readable (not a standard staking pool contract).',
      `Upgrade vote: ${vote(l)}.`,
      kicked ? `It was kicked out of the previous epoch: ${kicked.reason}.` : 'It was not kicked out of the previous epoch.',
    ].join('\n');
  }
  const top = r.lines.slice(0, opts.limit);
  const lines = top.map((l) => `${l.rank}. ${l.account_id} — ${n(l.stake_near)} NEAR (${pct(l.share)}), work done ${l.uptime === null ? 'n/a' : pct(l.uptime, 1)}${l.slashed ? ', SLASHED' : ''}, ${vote(l)}`);
  const topShare = top.reduce((s, l) => s + l.share, 0);
  const tail = [
    `The ${top.length} largest hold ${pct(topShare, 1)} of the stake.`,
    r.kicked_out.length ? `Kicked out of the previous epoch: ${r.kicked_out.slice(0, 10).map((k) => `${k.account_id} (${k.reason})`).join('; ')}${r.kicked_out.length > 10 ? `; and ${r.kicked_out.length - 10} more` : ''}.` : 'No validator was kicked out of the previous epoch.',
    'Pass account for one pool: its rank, work done, fee and upgrade vote.',
  ];
  return [head, '', ...lines, '', ...tail].join('\n');
}
