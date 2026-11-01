import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { approvalMet, fromRaw, matchForumTopic, percent, quorumRequired, veNear, type RawProposal } from '@/lib/house-of-stake';

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'near', 'hos-proposals.json'), 'utf8')) as RawProposal[];
const byId = (id: number) => fromRaw(raw.find((p) => p.id === id)!);

describe('fromRaw on vote.dao proposals (2026-11-01)', () => {
  it('reproduces the contract outcome for proposal 27, which it marked Succeeded', () => {
    const p = byId(27);
    expect(p.title).toBe('Remove the NEAR Developer Gas Rebate');
    expect(p.status).toBe('Succeeded');
    expect([p.quorum_met, p.approval_met]).toEqual([true, true]);
    expect(veNear(p.quorum_required)).toBe('1,784,006');
    expect([p.voters_for, p.voters_against, p.voters_abstain, p.voters_total]).toEqual([44, 2, 0, 46]);
  });

  it('dates proposal 29 and computes where its vote stands', () => {
    const p = byId(29);
    expect(p.status).toBe('Voting');
    expect(p.voting_starts_at).toMatch(/^2026-10-/);
    expect(Date.parse(p.voting_ends_at!) - Date.parse(p.voting_starts_at!)).toBe(14 * 86_400_000);
    expect(p.timelock_ends_at && Date.parse(p.timelock_ends_at) - Date.parse(p.voting_ends_at!)).toBe(14 * 86_400_000);
    expect(p.approval_threshold_bps).toBe(6667);
    expect([p.quorum_met, p.approval_met]).toEqual([true, true]);
    expect(percent(p.votes_total, p.total_venear)).toBe('62.29%');
    expect(veNear(p.votes_against)).toBe('<1');
  });

  it('leaves the outcome unknown for a proposal never snapshotted (rejected before voting)', () => {
    const p = byId(22);
    expect(p.status).toBe('Rejected');
    expect(p.quorum_required).toBeNull();
    expect(p.quorum_met).toBeNull();
    expect(p.approval_met).toBe(false);
  });
});

describe('veNear', () => {
  it('shows a vote below one veNEAR as <1, not 0', () => {
    expect(veNear('15456460682700000001')).toBe('<1');
    expect(veNear('0')).toBe('0');
    expect(veNear('3285084853944151343425937893923')).toBe('3,285,084');
  });
});

describe('the contract arithmetic', () => {
  it('takes the floor when the bps share of the snapshot is smaller', () => {
    expect(quorumRequired(BigInt(1000), 3500, BigInt(500))).toBe(BigInt(500));
    expect(quorumRequired(BigInt(1000), 3500, BigInt(100))).toBe(BigInt(350));
    expect(quorumRequired(BigInt(999), 10_000, BigInt(0))).toBe(BigInt(999));
  });

  it('meets approval at exactly the threshold, and not with no For or Against votes', () => {
    expect(approvalMet(BigInt(6667), BigInt(3333), 6667)).toBe(true);
    expect(approvalMet(BigInt(6666), BigInt(3334), 6667)).toBe(false);
    expect(approvalMet(BigInt(0), BigInt(0), 5000)).toBe(false);
  });
});

describe('matchForumTopic', () => {
  const topics = [
    { id: 42213, title: 'HSP-027: Remove the NEAR Developer Gas Rebate', url: 'https://gov.near.org/t/x/42213' },
    { id: 42644, title: 'HSP-029: Establish a 24-Month Issuance Ramp to a 1.6% Target Rate Of NEAR Token Emissions', url: 'u' },
    { id: 1, title: 'Test', url: 'u' },
  ];

  it('links by the title once its HSP prefix is set aside, and takes the HSP number from the thread', () => {
    expect(matchForumTopic({ title: 'Remove the NEAR Developer Gas Rebate' }, topics)).toMatchObject({ hsp: 27, by: 'title', topic: { id: 42213 } });
    expect(matchForumTopic({ title: 'Establish a 24-Month Issuance Ramp to a 1.6% Target Rate Of NEAR Token Emissions' }, topics)?.topic.id).toBe(42644);
  });

  it('links by HSP number when the on-chain title carries one', () => {
    expect(matchForumTopic({ title: 'HSP-027: Developer rebate (on-chain wording differs)' }, topics)).toMatchObject({ by: 'hsp', topic: { id: 42213 } });
  });

  it('prefers the final thread over its draft, and does not take a number mentioned mid-title', () => {
    const ts = [
      { id: 100, title: 'DRAFT HSP-XXX: Community Growth Initiative', url: 'a' },
      { id: 200, title: 'HSP-031: Community Growth Initiative', url: 'b' },
      { id: 300, title: 'Feedback on HSP-031 wording', url: 'c' },
    ];
    expect(matchForumTopic({ title: 'Community Growth Initiative' }, ts)).toMatchObject({ topic: { id: 200 }, hsp: 31 });
    expect(matchForumTopic({ title: 'HSP-031: Community Growth Initiative' }, ts)).toMatchObject({ topic: { id: 200 }, by: 'hsp' });
  });

  it('does not link a short or unmatched title', () => {
    expect(matchForumTopic({ title: 'Test' }, topics)).toBeNull();
    expect(matchForumTopic({ title: 'Something else entirely' }, topics)).toBeNull();
  });
});
