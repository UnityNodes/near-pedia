/**
 * Reading House of Stake proposals for agents and the REST API. Titles and
 * descriptions are written by proposers: rendered through the caller's fence.
 */

import type Database from 'better-sqlite3';
import { HOS_PROPOSAL_URL, percent, veNear } from './house-of-stake';
import { hspNumber } from './gov-forum';

export interface ProposalRow {
  id: number;
  title: string;
  status: string;
  status_since: string | null;
  flow: string | null;
  proposer_id: string;
  reviewer_id: string | null;
  created_at: string;
  approved_at: string | null;
  voting_starts_at: string | null;
  voting_ends_at: string | null;
  timelock_ends_at: string | null;
  expires_at: string | null;
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
  quorum_required: string | null;
  approval_threshold_bps: number | null;
  quorum_met: number | null;
  approval_met: number | null;
  has_actions: number;
  description: string | null;
  hsp_number: number | null;
  forum_topic_id: number | null;
  forum_url: string | null;
  forum_match: string | null;
  synced_at: string;
}

/**
 * Statuses the contract only leaves when someone calls it: a proposal past
 * its approval deadline stays `Created` on chain until then, and one past
 * its voting end stays `Voting`.
 */
export function effectiveStatus(
  p: Pick<ProposalRow, 'status' | 'expires_at' | 'voting_ends_at' | 'timelock_ends_at' | 'quorum_met' | 'approval_met'>,
  now: Date,
): { label: string; lapsed: boolean } {
  const t = now.getTime();
  if (p.status === 'Created' && p.expires_at && Date.parse(p.expires_at) < t) return { label: `Created, approval deadline passed ${p.expires_at.slice(0, 10)} (expires on its next contract call)`, lapsed: true };
  if (p.status === 'Voting' && p.voting_ends_at && Date.parse(p.voting_ends_at) < t) {
    const outcome = p.quorum_met === null || p.approval_met === null
      ? 'outcome unknown from the stored tally'
      : p.quorum_met && p.approval_met
        ? `would pass${p.timelock_ends_at ? ` and enter its timelock until ${p.timelock_ends_at.slice(0, 16)} UTC` : ''}`
        : 'would be defeated';
    return { label: `Voting closed ${p.voting_ends_at.slice(0, 16)} UTC, ${outcome} (finalised on its next contract call)`, lapsed: true };
  }
  if (p.status === 'Timelock' && p.timelock_ends_at && Date.parse(p.timelock_ends_at) < t) {
    return { label: `Timelock ended ${p.timelock_ends_at.slice(0, 16)} UTC without a veto (finalised on its next contract call)`, lapsed: true };
  }
  return { label: p.status, lapsed: false };
}

const NEVER_VOTED = new Set(['Rejected', 'Expired', 'Slashed']);

/** Proposals sharing an HSP number: a resubmission keeps the thread, and the newest one is not the only answer. */
export function proposalsForHsp(db: Database.Database, hsp: number): Array<{ id: number; status: string }> {
  return db.prepare('SELECT id, status FROM hos_proposals WHERE hsp_number = ? ORDER BY id DESC').all(hsp) as Array<{ id: number; status: string }>;
}

/** Whether House of Stake has been read at all on this database: an empty table is "not synced", not "no proposals". */
export function hosSynced(db: Database.Database): boolean {
  return Boolean(db.prepare('SELECT 1 FROM hos_stats LIMIT 1').get());
}

export function getProposal(db: Database.Database, ref: string | number): ProposalRow | null {
  const s = String(ref).trim();
  // A reference someone types, "HSP-027" or "hsp 27", not a thread title: no colon follows it.
  const typed = s.match(/^hsp[-\s#]?0*(\d{1,3})$/i);
  const hsp = typed ? Number(typed[1]) : /^hsp/i.test(s) ? hspNumber(s) : null;
  if (hsp !== null) {
    return (db.prepare('SELECT * FROM hos_proposals WHERE hsp_number = ? ORDER BY id DESC LIMIT 1').get(hsp) as ProposalRow | undefined) ?? null;
  }
  const id = Number(s.replace(/^#/, ''));
  return Number.isInteger(id) ? (db.prepare('SELECT * FROM hos_proposals WHERE id = ?').get(id) as ProposalRow | undefined) ?? null : null;
}

export function countProposals(db: Database.Database, opts: { status?: string; q?: string } = {}): number {
  const { where, params } = filters(opts);
  return (db.prepare(`SELECT COUNT(*) n FROM hos_proposals ${where}`).get(...params) as { n: number }).n;
}

export function listProposals(db: Database.Database, opts: { status?: string; q?: string; limit?: number } = {}): ProposalRow[] {
  const { where, params } = filters(opts);
  return db.prepare(`SELECT * FROM hos_proposals ${where} ORDER BY id DESC LIMIT ?`).all(...params, opts.limit ?? 20) as ProposalRow[];
}

function filters(opts: { status?: string; q?: string }): { where: string; params: (string | number)[] } {
  const conds: string[] = [];
  const params: (string | number)[] = [];
  if (opts.status) { conds.push('status = ? COLLATE NOCASE'); params.push(opts.status); }
  if (opts.q) { conds.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')"); const like = `%${opts.q.replace(/[\\%_]/g, '\\$&')}%`; params.push(like, like); }
  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

function standing(p: ProposalRow): string[] {
  if (!p.total_venear) {
    if (NEVER_VOTED.has(p.status)) return ['No veNEAR snapshot: the proposal never reached voting.'];
    if (p.status === 'Created' || p.status === 'Queued') return ['Not approved for voting yet: there is no veNEAR snapshot to vote with.'];
    return ['No veNEAR snapshot is stored for this proposal.'];
  }
  const bps = p.quorum_threshold_bps === null ? '?' : `${p.quorum_threshold_bps / 100}%`;
  const quorum = `${veNear(p.votes_total)} of ${veNear(p.quorum_required)} veNEAR needed for quorum (${bps} of the ${veNear(p.total_venear)} veNEAR snapshot, or the floor if higher): ${p.quorum_met ? 'met' : 'not met'}.`;
  const forAgainst = BigInt(p.votes_for) + BigInt(p.votes_against);
  const approval = `For ${percent(p.votes_for, forAgainst.toString())} of For + Against, ${p.approval_threshold_bps === null ? '?' : `${p.approval_threshold_bps / 100}%`} needed: ${p.approval_met ? 'met' : 'not met'}.`;
  return [
    `Votes: For ${veNear(p.votes_for)} veNEAR (${p.voters_for}), Against ${veNear(p.votes_against)} (${p.voters_against}), Abstain ${veNear(p.votes_abstain)} (${p.voters_abstain}).`,
    quorum,
    approval,
  ];
}

/**
 * `fence` wraps the short proposer-written fields inline; `fenceBlock`, when
 * given, wraps the description, which is long markdown and reads better in a
 * block of its own.
 */
function timelockText(p: ProposalRow): string {
  if (!p.timelock_ends_at) return '';
  const at = p.timelock_ends_at.slice(0, 16);
  if (p.status === 'Voting') return `, timelock until ${at} UTC if it passes`;
  if (p.status === 'Timelock') return `, timelock until ${at} UTC`;
  if (['Succeeded', 'Executable', 'InProgress', 'Failed', 'Vetoed'].includes(p.status)) return `, timelock ran to ${at} UTC`;
  return '';
}

export function renderProposal(
  p: ProposalRow,
  now: Date,
  fence: (s: string) => string,
  opts: { full?: boolean; fenceBlock?: (s: string) => string; sameHsp?: ReadonlyArray<{ id: number; status: string }> } = {},
): string {
  const status = effectiveStatus(p, now);
  const lines = [
    `## House of Stake proposal ${p.id}${p.hsp_number !== null ? ` (HSP-${String(p.hsp_number).padStart(3, '0')})` : ''}: ${fence(p.title)}`,
    `Status: ${status.label}${p.status_since ? ` (since ${p.status_since.slice(0, 16)} UTC)` : ''}. Flow: ${p.flow ?? '?'}${p.has_actions ? ', with on-chain actions' : ', signalling only'}.`,
    `Proposer ${fence(p.proposer_id)}${p.reviewer_id ? `, reviewer ${fence(p.reviewer_id)}` : ''}. Created ${p.created_at.slice(0, 10)}${p.voting_starts_at ? `, voting ${p.voting_starts_at.slice(0, 16)} – ${p.voting_ends_at?.slice(0, 16) ?? '?'} UTC` : ''}${timelockText(p)}.`,
    ...standing(p),
    `On chain: ${HOS_PROPOSAL_URL(p.id)} (vote.dao)${p.forum_url ? `. Forum: ${p.forum_url} (matched by ${p.forum_match === 'hsp' ? 'HSP number' : 'title'})` : '. No thread matched in the gov.near.org listings read.'}`,
  ];
  const others = (opts.sameHsp ?? []).filter((x) => x.id !== p.id);
  if (others.length) lines.push(`Other proposals with this HSP number: ${others.map((x) => `${x.id} (${x.status})`).join(', ')}.`);
  if (opts.full && p.description) lines.push('', 'Description (as the proposer wrote it):', (opts.fenceBlock ?? fence)(p.description.slice(0, 6000)) + (p.description.length > 6000 ? ` … [${p.description.length - 6000} more characters at ${HOS_PROPOSAL_URL(p.id)}]` : ''));
  return lines.join('\n');
}
