import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDb } from '@/lib/db';
import { fromRaw, type RawProposal } from '@/lib/house-of-stake';
import { countProposals, effectiveStatus, getProposal, hosSynced, listProposals, renderProposal } from '@/lib/hos-read';

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'near', 'hos-proposals.json'), 'utf8')) as RawProposal[];

function seed() {
  const db = getDb();
  const cols = ['id', 'title', 'status', 'flow', 'proposer_id', 'reviewer_id', 'created_at', 'approved_at', 'voting_starts_at', 'voting_ends_at', 'timelock_ends_at',
    'expires_at', 'snapshot_block_height', 'total_venear', 'votes_for', 'votes_against', 'votes_abstain', 'voters_for', 'voters_against', 'voters_abstain',
    'votes_total', 'voters_total', 'quorum_threshold_bps', 'quorum_floor', 'quorum_required', 'approval_threshold_bps', 'quorum_met', 'approval_met',
    'has_actions', 'link', 'description'];
  const ins = db.prepare(`INSERT INTO hos_proposals (${cols.join(', ')}, hsp_number, forum_topic_id, forum_url, forum_match, synced_at)
    VALUES (${cols.map((c) => `@${c}`).join(', ')}, @hsp_number, @forum_topic_id, @forum_url, @forum_match, 't')`);
  for (const r of raw) {
    const p = fromRaw(r);
    ins.run({ ...p, quorum_met: p.quorum_met === null ? null : Number(p.quorum_met), approval_met: p.approval_met === null ? null : Number(p.approval_met), has_actions: Number(p.has_actions),
      hsp_number: p.id === 27 ? 27 : p.id === 29 ? 29 : null, forum_topic_id: p.id === 27 ? 42213 : null,
      forum_url: p.id === 27 ? 'https://gov.near.org/t/hsp-027/42213' : null, forum_match: p.id === 27 ? 'title' : null });
  }
}

describe('reading proposals', () => {
  beforeEach(() => { resetDb(); seed(); });

  it('finds a proposal by id, by #id and by HSP number in any common spelling', () => {
    expect(getProposal(getDb(), 27)?.id).toBe(27);
    expect(getProposal(getDb(), '#29')?.id).toBe(29);
    expect(getProposal(getDb(), 'HSP-027')?.id).toBe(27);
    expect(getProposal(getDb(), 'hsp 29')?.id).toBe(29);
    expect(getProposal(getDb(), 'HSP-999')).toBeNull();
    expect(getProposal(getDb(), 'nonsense')).toBeNull();
  });

  it('filters by status and text, newest first', () => {
    expect(listProposals(getDb(), { status: 'Succeeded' }).map((p) => p.id)).toEqual([27]);
    expect(listProposals(getDb(), { q: 'Gas Rebate' }).map((p) => p.id)).toEqual([27]);
    expect(listProposals(getDb()).map((p) => p.id)).toEqual([29, 27, 22]);
  });

  it('renders the vote math, the links and the fenced proposer text', () => {
    const text = renderProposal(getProposal(getDb(), 27)!, new Date('2026-11-01T00:00:00Z'), (s) => `<<${s}>>`, { full: true });
    expect(text).toContain('## House of Stake proposal 27 (HSP-027): <<Remove the NEAR Developer Gas Rebate>>');
    expect(text).toContain('Votes: For 4,667,203 veNEAR (44), Against 1,818 (2), Abstain 0 (0).');
    expect(text).toContain('4,669,021 of 1,784,006 veNEAR needed for quorum (35% of the 5,097,162 veNEAR snapshot, or the floor if higher): met.');
    expect(text).toContain('Forum: https://gov.near.org/t/hsp-027/42213 (matched by title)');
    expect(text).toMatch(/Description \(as the proposer wrote it\):\n<</);
  });

  it('says a proposal whose voting ended is closed although the contract still says Voting', () => {
    const p = getProposal(getDb(), 29)!;
    expect(effectiveStatus(p, new Date('2026-10-20T00:00:00Z'))).toEqual({ label: 'Voting', lapsed: false });
    expect(effectiveStatus(p, new Date('2027-01-01T00:00:00Z')).label).toMatch(/^Voting closed .* would pass and enter its timelock/);
  });

  it('says a never-approved proposal past its deadline has lapsed', () => {
    const s = effectiveStatus({ status: 'Created', expires_at: '2026-06-01T00:00:00Z', voting_ends_at: null, timelock_ends_at: null, quorum_met: null, approval_met: null }, new Date('2026-11-01T00:00:00Z'));
    expect(s.label).toBe('Created, approval deadline passed 2026-06-01 (expires on its next contract call)');
  });

  it('says a closed vote that passes enters its timelock, and an unknown tally stays unknown', () => {
    const p = getProposal(getDb(), 29)!;
    expect(effectiveStatus(p, new Date('2026-11-05T00:00:00Z')).label).toMatch(/would pass and enter its timelock until 2026-11-16T16:48 UTC/);
    expect(effectiveStatus({ ...p, quorum_met: null }, new Date('2026-11-05T00:00:00Z')).label).toMatch(/outcome unknown/);
    expect(effectiveStatus({ ...p, status: 'Timelock' }, new Date('2026-12-01T00:00:00Z')).label).toMatch(/^Timelock ended 2026-11-16T16:48 UTC without a veto/);
  });

  it('words the timelock by status and leaves it out where none applies', () => {
    const p = getProposal(getDb(), 29)!;
    expect(renderProposal(p, new Date('2026-10-20T00:00:00Z'), (s) => s)).toContain('timelock until 2026-11-16T16:48 UTC if it passes');
    expect(renderProposal({ ...p, status: 'Defeated' }, new Date('2027-01-01T00:00:00Z'), (s) => s)).not.toContain('timelock');
  });

  it('tells a proposal waiting for approval from one that never voted', () => {
    const p = getProposal(getDb(), 22)!;
    expect(renderProposal({ ...p, status: 'Created' }, new Date(), (s) => s)).toContain('Not approved for voting yet');
  });

  it('names other proposals that share the HSP number', () => {
    const text = renderProposal(getProposal(getDb(), 27)!, new Date(), (s) => s, { sameHsp: [{ id: 27, status: 'Succeeded' }, { id: 31, status: 'Created' }] });
    expect(text).toContain('Other proposals with this HSP number: 31 (Created).');
  });

  it('counts across pages, matches status in any case, and knows when nothing was synced', () => {
    expect(countProposals(getDb(), {})).toBe(3);
    expect(listProposals(getDb(), { status: 'succeeded' }).map((p) => p.id)).toEqual([27]);
    expect(hosSynced(getDb())).toBe(false);
  });

  it('says a proposal that never got a snapshot never reached voting', () => {
    expect(renderProposal(getProposal(getDb(), 22)!, new Date(), (s) => s)).toContain('No veNEAR snapshot: the proposal never reached voting.');
  });
});
