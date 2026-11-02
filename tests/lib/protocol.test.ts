import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDb } from '@/lib/db';
import { effectLine, effectOn, parseUpgradeSchedule, passingVersion, protocolReport, renderProtocol, sampleHeights, tallyVotes } from '@/lib/protocol';

// nearcore 2.14.0 release notes, 2026-10-26 (CRLF as GitHub serves them).
const NEARCORE_2_14 = [
  '# Non-protocol Changes',
  '* Something.',
  '',
  '# Protocol upgrade voting',
  '',
  'This release upgrades the protocol version from 86 to 88 in two steps.',
  'Voting for protocol version 87 will start on Wednesday November 4th 00:00 UTC.',
  'Voting for protocol version 88 will start on Friday November 6th 00:00 UTC.',
  'To continue participating in consensus, you need to upgrade your node before voting for protocol version 87 starts.',
  '',
  'If voting succeeds in one epoch, each protocol upgrade is expected to happen 7-14 hours after the voting epoch ends.',
  '',
  '# Other',
  '* x',
].join('\r\n');

describe('parseUpgradeSchedule', () => {
  it('reads the two voting steps of nearcore 2.14.0 with their UTC start times', () => {
    expect(parseUpgradeSchedule(NEARCORE_2_14, '2026-10-26T12:00:00Z')).toEqual({
      from: 86,
      to: 88,
      steps: [
        { version: 87, starts_at: '2026-11-04T00:00:00.000Z' },
        { version: 88, starts_at: '2026-11-06T00:00:00.000Z' },
      ],
      after_vote: 'If voting succeeds in one epoch, each protocol upgrade is expected to happen 7-14 hours after the voting epoch ends.',
    });
  });

  it('puts a January vote of a December release in the next year', () => {
    const body = '# Protocol upgrade voting\nVoting for protocol version 90 will start on Monday January 11th 15:00 UTC.';
    expect(parseUpgradeSchedule(body, '2026-12-20T00:00:00Z')?.steps).toEqual([{ version: 90, starts_at: '2027-01-11T15:00:00.000Z' }]);
  });

  it('returns null for notes without the section', () => {
    expect(parseUpgradeSchedule('# Protocol Changes\n* Removed x.', '2026-10-26T00:00:00Z')).toBeNull();
  });
});

describe('tallyVotes', () => {
  const stakes = [
    { account_id: 'a', stake: BigInt(500), block_producer: true },
    { account_id: 'b', stake: BigInt(300), block_producer: true },
    { account_id: 'c', stake: BigInt(200), block_producer: true },
    { account_id: 'chunk-only', stake: BigInt(9_000), block_producer: false },
  ];

  it('weights each producer vote by stake over the whole block-producer stake', () => {
    const t = tallyVotes([{ account_id: 'a', version: 87 }, { account_id: 'b', version: 86 }], stakes);
    expect(t.shares).toEqual([{ version: 87, share: 0.5, producers: 1, stake: '500' }, { version: 86, share: 0.3, producers: 1, stake: '300' }]);
    expect(t.total_stake).toBe('1000');
    expect(t.coverage).toBe(0.8);
    expect([t.producers, t.producers_seen]).toEqual([3, 2]);
  });

  it('ignores votes from accounts that are not block producers this epoch', () => {
    expect(tallyVotes([{ account_id: 'chunk-only', version: 88 }], stakes).shares).toEqual([]);
  });
});

describe('passingVersion', () => {
  const t = (stake87: string) => ({ shares: [{ version: 87, share: 0, producers: 1, stake: stake87 }], total_stake: '1000', coverage: 1, producers: 1, producers_seen: 1 });

  it('needs strictly more than the threshold, as nearcore compares', () => {
    expect(passingVersion(t('800'), 86, 4, 5)).toBeNull();
    expect(passingVersion(t('801'), 86, 4, 5)).toBe(87);
  });

  it('ignores the current version and a missing threshold', () => {
    expect(passingVersion(t('900'), 87, 4, 5)).toBeNull();
    expect(passingVersion(t('900'), 86, null, null)).toBeNull();
  });
});

describe('parseUpgradeSchedule robustness', () => {
  it('reads abbreviated months, "begins" and a comma, and stops at a second-level heading', () => {
    const body = '# Protocol upgrade voting\nVoting for protocol version 89 begins on Tue, Dec. 1st, 15:30 UTC.\n## Other\nVoting for protocol version 99 will start on Monday January 1st 00:00 UTC.';
    expect(parseUpgradeSchedule(body, '2026-11-20T00:00:00Z')?.steps).toEqual([{ version: 89, starts_at: '2026-12-01T15:30:00.000Z' }]);
  });

  it('returns null for an unusable release date instead of throwing', () => {
    expect(parseUpgradeSchedule(NEARCORE_2_14, 'not a date')).toBeNull();
  });
});

describe('sampleHeights', () => {
  it('takes every height when the gap is small, newest first', () => {
    expect(sampleHeights(95, 100, 0, 10)).toEqual([100, 99, 98, 97, 96]);
  });

  it('spreads samples evenly over a long gap and never before the epoch start', () => {
    const h = sampleHeights(null, 1_000, 900, 10);
    expect(h).toHaveLength(10);
    expect(h[0]).toBe(1_000);
    expect(Math.min(...h)).toBeGreaterThanOrEqual(900);
  });

  it('returns nothing when already up to date', () => {
    expect(sampleHeights(100, 100, 0, 10)).toEqual([]);
  });
});

describe('protocolReport and renderProtocol', () => {
  beforeEach(() => resetDb());

  function seed() {
    const db = getDb();
    const snap = db.prepare(`INSERT INTO protocol_snapshots (network, observed_at, chain_id, protocol_version, latest_protocol_version, node_version, block_height,
      block_time, epoch_id, epoch_height, epoch_start_height, epoch_length, threshold_num, threshold_den, endpoint) VALUES (?, ?, ?, ?, ?, '2.14.0', ?, ?, 'E', 4925, ?, 43200, 4, 5, 'https://rpc')`);
    snap.run('mainnet', '2026-11-01T17:00:00Z', 'mainnet', 86, 88, 222_600_000, '2026-11-01T17:00:00Z', 222_580_337);
    snap.run('testnet', '2026-10-30T00:00:00Z', 'testnet', 87, 88, 100, '2026-10-30T00:00:00Z', 0);
    snap.run('testnet', '2026-11-01T17:00:00Z', 'testnet', 88, 88, 275_778_357, '2026-11-01T17:00:00Z', 275_744_120);
    const st = db.prepare("INSERT INTO validator_stakes (network, epoch_id, account_id, stake, block_producer) VALUES ('mainnet', 'E', ?, ?, ?)");
    st.run('a', '500', 1); st.run('b', '300', 1); st.run('c', '200', 1);
    const v = db.prepare("INSERT INTO validator_votes (network, epoch_id, account_id, voted_version, block_height, block_time) VALUES ('mainnet', 'E', ?, ?, 1, 't')");
    v.run('a', 86); v.run('b', 86);
    db.prepare(`INSERT INTO github_releases (id, repo, tag, name, body, published_at, url, prerelease, synced_at) VALUES ('r', 'near/nearcore', '2.14.0', '2.14.0', ?, '2026-10-26T12:00:00Z', 'https://github.com/near/nearcore/releases/tag/2.14.0', 0, 't')`).run(NEARCORE_2_14);
    db.prepare(`INSERT INTO deprecations (id, title, kind, status, strength, summary, effective_protocol, matchers, subjects, origin, built_at)
      VALUES ('delegate-v2', 'DelegateV2 meta-transaction action', 'protocol', 'removed', 'strong', 's', 87, '{}', '[]', 'seed', 't')`).run();
  }

  it('reports each network with its vote, schedule and what waits on the upgrade', () => {
    seed();
    const text = renderProtocol(protocolReport(getDb(), ['mainnet', 'testnet']), new Date('2026-11-01T18:00:00Z'));
    expect(text).toContain('## mainnet — protocol 86 (its nodes support up to 88)');
    expect(text).toContain('Upgrade vote this epoch, by block-producer stake: 86: 80.0% (2 producers). Read from 2 of 3 producers, 80.0% of their stake.');
    expect(text).toContain('Voting for 87 starts 2026-11-04T00:00 UTC, in 2d 6h.');
    expect(text).toContain('Waiting on these upgrades: DelegateV2 meta-transaction action (protocol 87; check_deprecation("delegate-v2")).');
    expect(text).toContain('## testnet — protocol 88');
    expect(text.split('## testnet')[1]).not.toContain('Voting for');
    expect(text.split('## testnet')[1]).toContain('No newer protocol version is supported by its nodes. (Release notes schedule mainnet only.)');
    expect(text).toContain('Mainnet schedule from nearcore 2.14.0 release notes');
    expect(text).toMatch(/⟪[^⟫]*expected to happen 7-14 hours[^⟫]*⟫/);
  });

  it('dates a version only from an upgrade seen between snapshots', () => {
    seed();
    expect(effectOn(getDb(), 87, ['mainnet', 'testnet'], new Date('2026-11-01T17:30:00Z'))).toEqual([
      { network: 'mainnet', version: 86, in_effect: false, observed_at: '2026-11-01T17:00:00Z', first_observed: null, stale: false },
      { network: 'testnet', version: 88, in_effect: true, observed_at: '2026-11-01T17:00:00Z', first_observed: null, stale: false },
    ]);
    expect(effectOn(getDb(), 88, ['mainnet', 'testnet'], new Date('2026-11-01T17:30:00Z'))[1].first_observed).toBe('2026-11-01T17:00:00Z');
    expect(effectOn(getDb(), 86, ['mainnet', 'testnet'], new Date('2026-11-01T17:30:00Z'))[0].first_observed).toBeNull();
  });

  it('says the switch is decided when the previous epoch passed, though this epoch shows no new votes yet', () => {
    seed();
    const db = getDb();
    db.prepare(`INSERT INTO protocol_snapshots (network, observed_at, chain_id, protocol_version, latest_protocol_version, node_version, block_height,
      block_time, epoch_id, epoch_height, epoch_start_height, epoch_length, threshold_num, threshold_den, endpoint)
      VALUES ('mainnet', '2026-11-01T05:00:00Z', 'mainnet', 86, 88, '2.14.0', 222560000, '2026-11-01T05:00:00Z', 'P', 4924, 222537137, 43200, 4, 5, 'https://rpc')`).run();
    const st = db.prepare("INSERT INTO validator_stakes (network, epoch_id, account_id, stake, block_producer) VALUES ('mainnet', 'P', ?, ?, 1)");
    st.run('a', '500'); st.run('b', '400'); st.run('c', '100');
    const v = db.prepare("INSERT INTO validator_votes (network, epoch_id, account_id, voted_version, block_height, block_time) VALUES ('mainnet', 'P', ?, 87, 1, 't')");
    v.run('a'); v.run('b');
    const text = renderProtocol(protocolReport(db, ['mainnet'], new Date('2026-11-01T18:00:00Z')), new Date('2026-11-01T18:00:00Z'));
    expect(text).toContain("The previous epoch's vote carried 87 past the threshold (90.0% of block-producer stake");
  });

  it('marks a snapshot older than two hours stale, and a stale "not yet" as unknown', () => {
    seed();
    const later = new Date('2026-11-02T00:00:00Z');
    expect(renderProtocol(protocolReport(getDb(), ['mainnet'], later), later)).toContain('STALE');
    expect(effectOn(getDb(), 87, ['mainnet', 'testnet'], later).map((e) => e.in_effect)).toEqual([null, true]);
    expect(effectLine(effectOn(getDb(), 87, ['mainnet'], later), 87)).toContain('current state unknown');
  });

  it('measures the block rate from a sampled vote block when there is one snapshot, and makes no guess without one', () => {
    seed();
    const db = getDb();
    expect(protocolReport(db, ['mainnet'], new Date('2026-11-01T17:05:00Z')).networks[0].block_rate).toBeNull();
    db.prepare("UPDATE validator_votes SET block_height = 222598280, block_time = '2026-11-01T16:43:20Z'").run();
    const n = protocolReport(db, ['mainnet'], new Date('2026-11-01T17:05:00Z')).networks[0];
    expect(n.block_rate).toBeCloseTo(1.72, 2);
    expect(n.seconds_left).not.toBeNull();
  });

  it('says nothing about the epoch once the projection runs past its end', () => {
    seed();
    const db = getDb();
    db.prepare("UPDATE validator_votes SET block_height = 222598280, block_time = '2026-11-01T16:43:20Z'").run();
    const n = protocolReport(db, ['mainnet'], new Date('2026-11-02T06:00:00Z')).networks[0];
    expect(n.epoch_progress).toBeNull();
    expect(renderProtocol({ networks: [n], schedule: null }, new Date('2026-11-02T06:00:00Z'))).not.toMatch(/through now/);
  });

  it('says plainly when nothing has been synced', () => {
    expect(renderProtocol(protocolReport(getDb(), ['mainnet']), new Date())).toMatch(/has not run/);
  });
});
