import { describe, expect, it } from 'vitest';
import { buildReport, kickoutReason, renderValidators, uptimeOf } from '@/lib/validators';

const Y = '000000000000000000000000';
const set = {
  epoch_height: 4929,
  current_validators: [
    { account_id: 'small.poolv1.near', stake: `100${Y}`, num_produced_blocks: 0, num_expected_blocks: 0, num_produced_chunks: 9, num_expected_chunks: 10 },
    { account_id: 'big.poolv1.near', stake: `300${Y}`, num_produced_blocks: 10, num_expected_blocks: 10, num_produced_chunks: 50, num_expected_chunks: 50, num_produced_endorsements: 40, num_expected_endorsements: 40 },
    { account_id: 'idle.poolv1.near', stake: `100${Y}` },
  ],
  prev_epoch_kickout: [
    { account_id: 'gone.poolv1.near', reason: { NotEnoughChunks: { produced: 1, expected: 100 } } },
    { account_id: 'left.poolv1.near', reason: 'Unstaked' },
  ],
};

describe('validators', () => {
  it('ranks by stake, gives each its share, work done and vote', () => {
    const r = buildReport(set, new Map([['big.poolv1.near', 88]]), 'https://rpc');
    expect(r.total_stake_near).toBe(500);
    expect(r.lines.map((l) => l.account_id)).toEqual(['big.poolv1.near', 'small.poolv1.near', 'idle.poolv1.near']);
    expect(r.lines[0]).toMatchObject({ rank: 1, stake_near: 300, share: 0.6, uptime: 1, voted_version: 88 });
    expect(r.lines[1].uptime).toBeCloseTo(0.9);
    expect(r.lines[2].uptime).toBeNull();
  });

  it('reads kickout reasons in both shapes nearcore sends', () => {
    expect(kickoutReason('Unstaked')).toBe('Unstaked');
    expect(kickoutReason({ NotEnoughChunks: { produced: 1, expected: 100 } })).toBe('NotEnoughChunks (1 of 100 expected)');
    expect(uptimeOf({ account_id: 'x', stake: '1' })).toBeNull();
  });

  it('answers for one pool, and says plainly when it is not in the set', () => {
    const r = buildReport(set, new Map([['big.poolv1.near', 88]]), 'https://rpc');
    const one = renderValidators(r, { limit: 20, account: 'big.poolv1.near', fee: 0.05, latest_version: 88 });
    expect(one).toContain('Rank 1 of 3 by stake: 300 NEAR, 60.00% of all stake.');
    expect(one).toContain('Pool fee: 5.0% of rewards');
    expect(one).toContain('announced protocol 88 (the newest)');
    expect(renderValidators(buildReport(set, new Map([['big.poolv1.near', 86]]), 'https://rpc', 4927), { limit: 1 })).toContain('announced protocol 86 in epoch 4927');
    expect(renderValidators(r, { limit: 20, account: 'gone.poolv1.near' })).toContain('kicked out of the previous epoch: NotEnoughChunks (1 of 100 expected)');
    expect(renderValidators(r, { limit: 2 })).toContain('The 2 largest hold 80.0% of the stake.');
  });
});
