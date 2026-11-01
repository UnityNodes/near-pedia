/**
 * House of Stake governance, read from its contracts on mainnet: proposals
 * on vote.dao, veNEAR on venear.dao, and the forum thread each proposal is
 * discussed in.
 *
 * Outcome math follows the voting contract's `compute_final_status`
 * (houseofstake/house-of-stake-contracts, voting-contract/src/proposal.rs,
 * read 2026-11-01): quorum is the larger of quorum_threshold_bps of the
 * snapshot's total veNEAR (integer bps over 10,000) and quorum_floor, met
 * when all votes including Abstain reach it; approval is met when
 * For * 10,000 >= approval_threshold_bps * (For + Against), Abstain left
 * out. votes[0] is For, votes[1] Against, votes[2] Abstain.
 */

import { hspNumber, isDraft, titleKey } from './gov-forum';

export const VOTE_CONTRACT = 'vote.dao';
export const VENEAR_CONTRACT = 'venear.dao';
export const HOS_PROPOSAL_URL = (id: number) => `https://houseofstake.org/proposals/${id}`;

const BPS_MAX = BigInt(10_000);
const YOCTO = BigInt('1000000000000000000000000');

export interface RawProposal {
  id: number;
  title?: string | null;
  description?: string | null;
  link?: string | null;
  proposer_id: string;
  reviewer_id?: string | null;
  status: string;
  flow?: string | null;
  creation_time_ns: string;
  approval_time_ns?: string | null;
  voting_start_time_ns?: string | null;
  voting_duration_ns: string;
  timelock_duration_ns?: string | null;
  expiration_ns?: string | null;
  snapshot_and_state?: { snapshot?: { block_height?: number }; total_venear?: string } | null;
  votes?: Array<{ total_venear: string; total_votes: number }>;
  total_votes?: { total_venear: string; total_votes: number };
  quorum_threshold_bps?: number | null;
  quorum_floor?: string | null;
  approval_threshold_bps?: number | null;
  actions?: unknown;
}

export interface Proposal {
  id: number;
  title: string;
  status: string;
  flow: string | null;
  proposer_id: string;
  reviewer_id: string | null;
  created_at: string;
  approved_at: string | null;
  voting_starts_at: string | null;
  voting_ends_at: string | null;
  timelock_ends_at: string | null;
  expires_at: string | null;
  snapshot_block_height: number | null;
  /** veNEAR amounts in yoctoNEAR, as decimal strings. */
  total_venear: string | null;
  votes_for: string;
  votes_against: string;
  votes_abstain: string;
  voters_for: number;
  voters_against: number;
  voters_abstain: number;
  votes_total: string;
  voters_total: number;
  quorum_threshold_bps: number | null;
  quorum_floor: string | null;
  quorum_required: string | null;
  approval_threshold_bps: number | null;
  quorum_met: boolean | null;
  approval_met: boolean | null;
  has_actions: boolean;
  link: string | null;
  description: string | null;
}

const nsToIso = (ns: string | null | undefined): string | null => {
  if (!ns || ns === '0') return null;
  const ms = Number(BigInt(ns) / BigInt(1_000_000));
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
};

const addNs = (a: string | null | undefined, b: string | null | undefined): string | null =>
  a && b && a !== '0' ? nsToIso((BigInt(a) + BigInt(b)).toString()) : null;

export function quorumRequired(totalVenear: bigint, bps: number, floor: bigint): bigint {
  const b = BigInt(bps);
  const part = b === BigInt(0) ? BigInt(0) : b === BPS_MAX ? totalVenear : (totalVenear * b) / BPS_MAX;
  return part > floor ? part : floor;
}

export function approvalMet(forPower: bigint, against: bigint, bps: number): boolean {
  const denom = forPower + against;
  return denom > BigInt(0) && forPower * BPS_MAX >= BigInt(bps) * denom;
}

export function fromRaw(p: RawProposal): Proposal {
  const vote = (i: number) => p.votes?.[i] ?? { total_venear: '0', total_votes: 0 };
  const total = p.snapshot_and_state?.total_venear ?? null;
  const floor = p.quorum_floor ?? null;
  const required = total !== null && p.quorum_threshold_bps != null ? quorumRequired(BigInt(total), p.quorum_threshold_bps, BigInt(floor ?? '0')) : null;
  const votesTotal = p.total_votes?.total_venear ?? '0';
  const votingEnds = addNs(p.voting_start_time_ns, p.voting_duration_ns);
  return {
    id: p.id,
    title: p.title?.trim() || `Proposal ${p.id}`,
    status: p.status,
    flow: p.flow ?? null,
    proposer_id: p.proposer_id,
    reviewer_id: p.reviewer_id ?? null,
    created_at: nsToIso(p.creation_time_ns) ?? new Date(0).toISOString(),
    approved_at: nsToIso(p.approval_time_ns),
    voting_starts_at: nsToIso(p.voting_start_time_ns),
    voting_ends_at: votingEnds,
    // Classic only, and only a real timelock: when it applies depends on the
    // status, which the renderer words ("if it passes", "until", "ended").
    timelock_ends_at: p.flow !== 'FastTrack' && p.voting_start_time_ns && p.timelock_duration_ns && BigInt(p.timelock_duration_ns) > BigInt(0)
      ? addNs((BigInt(p.voting_start_time_ns) + BigInt(p.voting_duration_ns)).toString(), p.timelock_duration_ns)
      : null,
    expires_at: nsToIso(p.expiration_ns),
    snapshot_block_height: p.snapshot_and_state?.snapshot?.block_height ?? null,
    total_venear: total,
    votes_for: vote(0).total_venear,
    votes_against: vote(1).total_venear,
    votes_abstain: vote(2).total_venear,
    voters_for: vote(0).total_votes,
    voters_against: vote(1).total_votes,
    voters_abstain: vote(2).total_votes,
    votes_total: votesTotal,
    voters_total: p.total_votes?.total_votes ?? 0,
    quorum_threshold_bps: p.quorum_threshold_bps ?? null,
    quorum_floor: floor,
    quorum_required: required?.toString() ?? null,
    approval_threshold_bps: p.approval_threshold_bps ?? null,
    quorum_met: required === null ? null : BigInt(votesTotal) >= required,
    approval_met: p.approval_threshold_bps == null ? null : approvalMet(BigInt(vote(0).total_venear), BigInt(vote(1).total_venear), p.approval_threshold_bps),
    has_actions: Array.isArray(p.actions) ? p.actions.length > 0 : Boolean(p.actions),
    link: p.link?.trim() || null,
    description: p.description ?? null,
  };
}

/** yoctoNEAR as whole veNEAR with thousands separators: "3,285,084". */
export function veNear(yocto: string | null): string {
  if (yocto === null) return '?';
  const v = BigInt(yocto);
  // A vote of 15 veNEAR was "Against 0 (1)": one voter and nothing to show for it.
  if (v > BigInt(0) && v < YOCTO) return '<1';
  return (v / YOCTO).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * a / b as a percentage, computed in integers, with two decimals: one
 * decimal floored printed "66.6% … 66.67% needed: met".
 */
export function percent(a: string, b: string | null): string {
  if (!b || BigInt(b) === BigInt(0)) return '?';
  return `${(Number((BigInt(a) * BigInt(10_000)) / BigInt(b)) / 100).toFixed(2)}%`;
}

export interface ForumTopicRef { id: number; title: string; url: string }

/**
 * The forum thread a proposal is discussed in: by HSP number when both
 * titles carry one, otherwise by the title with its HSP prefix removed
 * ("Remove the NEAR Developer Gas Rebate" on chain is "HSP-027: Remove the
 * NEAR Developer Gas Rebate" on the forum). A title match must be exact
 * after normalising; containment matched too many short titles.
 */
export function matchForumTopic(p: Pick<Proposal, 'title'>, topics: readonly ForumTopicRef[]): { topic: ForumTopicRef; hsp: number | null; by: 'hsp' | 'title' } | null {
  // Of several candidates, the final thread over its DRAFT, then the newest:
  // a draft and its final thread share a title, and the draft has no number.
  const best = (xs: ForumTopicRef[]) => xs.sort((a, b) => Number(isDraft(a.title)) - Number(isDraft(b.title)) || b.id - a.id)[0];
  const own = hspNumber(p.title);
  if (own !== null) {
    const t = best(topics.filter((x) => hspNumber(x.title) === own));
    if (t) return { topic: t, hsp: own, by: 'hsp' };
  }
  const key = titleKey(p.title);
  if (key.length < 12) return null;
  const t = best(topics.filter((x) => titleKey(x.title) === key));
  return t ? { topic: t, hsp: own ?? hspNumber(t.title), by: 'title' } : null;
}
