import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  draftItems, eventItems, incidentItems, nodeReleaseItems, proposalItems, protocolItems, releaseUrgency,
  type ProposalState,
} from '@/lib/near-radar';
import { RADAR_EVENTS } from '@/lib/radar-events';
import { radarExpiryProblems } from '../../scripts/check-radar-expiry';
import { refreshRadar } from '../../scripts/refresh-radar';
import type { ProtocolReport } from '@/lib/protocol';

const NOW = new Date('2026-11-01T18:00:00.000Z');

function report(current: number, opts: { to?: number; voted?: number; share?: number; passing?: number | null; observedAt?: string } = {}): ProtocolReport {
  const shares = opts.voted ? [{ version: opts.voted, share: opts.share ?? 0.5, producers: 10, stake: '1' }] : [];
  return {
    schedule: opts.to ? { release: '2.14.0', release_url: 'https://github.com/near/nearcore/releases/tag/2.14.0', published_at: '2026-10-26T18:59:52Z', from: current, to: opts.to, steps: [], after_vote: null } : null,
    networks: [{
      snapshot: { network: 'mainnet', observed_at: opts.observedAt ?? NOW.toISOString(), chain_id: 'mainnet', protocol_version: current, latest_protocol_version: 88, node_version: '2.14.0', block_height: 1, block_time: NOW.toISOString(), epoch_id: 'e', epoch_height: 1, epoch_start_height: 1, epoch_length: 43200, threshold_num: 4, threshold_den: 5, endpoint: 'x' },
      tally: { shares, total_stake: '1', coverage: 1, producers: 10, producers_seen: 10 },
      previous: null, epoch_progress: 0.5, seconds_left: 1000, block_rate: 1.7, threshold: 0.8, passing: opts.passing ?? null, age_s: 60,
      pending_steps: opts.to ? [{ version: 87, starts_at: '2026-11-04T00:00:00.000Z' }, { version: 88, starts_at: '2026-11-06T00:00:00.000Z' }] : [],
      waiting: [],
    }],
  } as ProtocolReport;
}

describe('protocolItems', () => {
  it('raises a critical mainnet upgrade while the release schedules a higher version, due at the next voting step', () => {
    const [i] = protocolItems(report(86, { to: 88 }), NOW);
    expect(i).toMatchObject({ sourceType: 'protocol_upgrade', sourceId: 'mainnet:86', level: 'critical', deadline: '2026-11-04T00:00:00.000Z' });
    expect(i.title).toContain('86 → 88');
  });

  it('lives only as long as its snapshot is fresh, so a stopped protocol sync cannot keep it up', () => {
    expect(protocolItems(report(86, { to: 88 }), NOW)[0].expiresAt).toBe('2026-11-01T22:00:00.000Z');
    expect(protocolItems(report(86, { to: 88, observedAt: '2026-11-01T12:00:00.000Z' }), NOW)).toEqual([]);
  });

  it('lapses 14 days after the last voting step even with fresh snapshots', () => {
    expect(protocolItems(report(86, { to: 88, observedAt: '2026-11-20T00:00:00.000Z' }), new Date('2026-11-20T00:00:01.000Z'))).toEqual([]);
  });

  it('keeps one id while the voted target moves, so a moving vote is one alert, not a new one each time', () => {
    expect(protocolItems(report(86, { voted: 87, share: 0.3 }), NOW)[0].sourceId).toBe(protocolItems(report(86, { voted: 88, share: 0.3 }), NOW)[0].sourceId);
  });

  it('ignores a stray node voting for a higher version', () => {
    expect(protocolItems(report(86, { voted: 87, share: 0.01 }), NOW)).toEqual([]);
  });

  it('raises nothing once the network runs the scheduled version', () => {
    expect(protocolItems(report(88, { to: 88 }), NOW)).toEqual([]);
  });

  it('raises an upgrade from validator votes alone, when no release schedules one', () => {
    expect(protocolItems(report(86, { voted: 87 }), NOW)[0]?.title).toContain('86 → 87');
  });
});

describe('releaseUrgency and nodeReleaseItems', () => {
  const body = (code: string, sec: boolean) => '```\nCODE_COLOR: ' + code + '\nSECURITY_UPGRADE: ' + (sec ? 'TRUE' : 'FALSE') + '\n```';
  it('reads the CODE_COLOR block nearcore opens every release with', () => {
    expect(releaseUrgency(body('CODE_YELLOW_MAINNET', false))).toEqual({ code: 'CODE_YELLOW_MAINNET', security: false });
  });

  it('alerts on the newest stable release only when it is CODE_RED or a security release, for 30 days', () => {
    const red = { tag: '2.14.1', url: 'u', published_at: '2026-10-30T00:00:00Z', body: body('CODE_RED_MAINNET', false) };
    const yellow = { tag: '2.14.0', url: 'u', published_at: '2026-10-26T00:00:00Z', body: body('CODE_YELLOW_MAINNET', false) };
    expect(nodeReleaseItems([yellow], NOW)).toEqual([]);
    expect(nodeReleaseItems([yellow, red], NOW)[0]).toMatchObject({ sourceId: '2.14.1', level: 'critical', expiresAt: '2026-11-29T00:00:00.000Z' });
    expect(nodeReleaseItems([red], new Date('2026-12-01T00:00:00Z'))).toEqual([]);
  });

  it('judges the newest release by version, and ignores testnet codes', () => {
    const red = { tag: '2.14.1', url: 'u', published_at: '2026-10-30T00:00:00Z', body: body('CODE_RED_MAINNET', false) };
    const backport = { tag: '2.13.5', url: 'u', published_at: '2026-10-31T00:00:00Z', body: body('CODE_GREEN_MAINNET', false) };
    expect(nodeReleaseItems([red, backport], NOW)[0]?.sourceId).toBe('2.14.1');
    expect(nodeReleaseItems([{ ...red, body: body('CODE_RED_TESTNET', false) }], NOW)).toEqual([]);
  });

  it('drops a red release once a newer stable one ships', () => {
    const red = { tag: '2.14.1', url: 'u', published_at: '2026-10-30T00:00:00Z', body: body('CODE_RED_MAINNET', true) };
    const next = { tag: '2.14.2', url: 'u', published_at: '2026-10-31T00:00:00Z', body: body('CODE_GREEN_MAINNET', false) };
    expect(nodeReleaseItems([red, next], NOW)).toEqual([]);
  });
});

describe('proposalItems', () => {
  const base: ProposalState = {
    id: 29, title: 'Issuance ramp', status: 'Voting', hsp_number: 29, created_at: '2026-10-20T00:00:00Z', approved_at: '2026-10-26T00:00:00Z',
    voting_ends_at: '2026-11-02T16:48:08.461Z', timelock_ends_at: '2026-11-16T16:48:08.461Z',
    votes_for: '3000000000000000000000000000000', votes_against: '0', votes_abstain: '0', votes_total: '3000000000000000000000000000000',
    quorum_required: '1000000000000000000000000000000', quorum_met: 1, approval_met: 1, has_actions: 1, forum_url: 'https://gov.near.org/t/x/42644',
  };

  it('keeps a vote until it ends, and the item expires with it', () => {
    const [i] = proposalItems([base], NOW);
    expect(i).toMatchObject({ sourceType: 'hos_vote', deadline: base.voting_ends_at, expiresAt: base.voting_ends_at, url: base.forum_url });
    expect(proposalItems([base], new Date('2026-11-02T17:00:00Z'))).toEqual([]);
  });

  it('keeps a passed proposal with actions through its timelock', () => {
    const [i] = proposalItems([{ ...base, status: 'Timelock' }], new Date('2026-11-05T00:00:00Z'));
    expect(i).toMatchObject({ sourceType: 'hos_timelock', level: 'important', expiresAt: base.timelock_ends_at });
  });
});

describe('draftItems', () => {
  const th = (id: number, title: string, last = '2026-10-27T15:34:48Z') => ({ id, title, url: `https://gov.near.org/t/${id}`, created_at: last, last_post_at: last });

  it('keeps a draft and a numbered HSP not on chain, and drops one that is', () => {
    const items = draftItems([th(1, 'DRAFT HSP-XXX: Community Growth Initiative'), th(2, 'HSP-031: Something new'), th(3, 'HSP-028: Registrar')], new Set([28]), NOW);
    expect(items.map((i) => i.sourceId)).toEqual(['1', '2']);
  });

  it('drops withdrawn threads and drafts quiet for 30 days', () => {
    expect(draftItems([th(4, 'WITHDRAWN: HSP-XXX: Budget'), th(5, 'DRAFT HSP-XXX: Old', '2026-09-01T00:00:00Z')], new Set(), NOW)).toEqual([]);
  });

  it('drops a draft whose title matches a proposal already on chain', () => {
    expect(draftItems([th(7, 'DRAFT HSP-XXX: Community Growth Initiative')], new Set(), NOW, new Set(['community growth initiative']))).toEqual([]);
  });

  it('is not fooled by a thread that only mentions an HSP', () => {
    expect(draftItems([th(6, 'Feedback on HSP-8 wording')], new Set(), NOW)).toEqual([]);
  });
});

describe('incidentItems and eventItems', () => {
  const inc = (date: string, relevance = 'near') => ({ id: `x-${date}`, name: 'X', date, amount_usd: 1e6, technique: null, source_url: 'https://defillama.com/hacks', relevance, catalog_slug: null });

  it('keeps a NEAR incident for 30 days after the hack, and never a related one', () => {
    expect(incidentItems([inc('2026-10-20')], NOW)[0]?.expiresAt).toBe('2026-11-19T00:00:00.000Z');
    expect(incidentItems([inc('2026-10-01')], NOW)).toEqual([]);
    expect(incidentItems([inc('2026-10-20', 'related')], NOW)).toEqual([]);
  });

  it('drops an event at its date', () => {
    expect(eventItems(RADAR_EVENTS, NOW).map((e) => e.sourceId)).toContain('near-hackathon-2026-submissions');
    expect(eventItems(RADAR_EVENTS, new Date('2026-11-15T00:00:00Z'))).toEqual([]);
  });
});

describe('radarExpiryProblems', () => {
  const row = (id: number, expires_at: string | null, source_id = String(id)) => ({ id, source_type: 'hos_vote', source_id, title: 't', expires_at });

  it('flags a row without expiry, a live row no longer true, and an expiry too far out', () => {
    const live = [row(2, '2026-11-02T00:00:00Z'), row(3, '2027-06-01T00:00:00Z')];
    const problems = radarExpiryProblems([row(1, null), ...live], live, new Set([`hos_vote\u00003`]), NOW);
    expect(problems.map((p) => p.split(':')[0])).toEqual(['no expiry', 'live but no longer true', 'expires over 120 days out']);
  });

  it('passes when every live row is still true', () => {
    const live = [row(2, '2026-11-02T00:00:00Z')];
    expect(radarExpiryProblems(live, live, new Set([`hos_vote\u00002`]), NOW)).toEqual([]);
  });
});

describe('refreshRadar on a database', () => {
  function db() {
    const d = new Database(':memory:');
    d.exec(`CREATE TABLE radar_items (id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT NOT NULL, title TEXT NOT NULL, body TEXT, source_type TEXT NOT NULL,
      source_id TEXT NOT NULL, source_url TEXT, affects TEXT DEFAULT '[]', deadline TEXT, published_at TEXT NOT NULL, expires_at TEXT, tg_sent INTEGER DEFAULT 0,
      created_at TEXT NOT NULL, UNIQUE(source_type, source_id))`);
    return d;
  }
  const liveVote = (d: Database.Database) => d.prepare(`INSERT INTO radar_items (level, title, source_type, source_id, published_at, expires_at, created_at)
    VALUES ('important', 'old vote', 'hos_vote', '29', '2026-10-26T00:00:00Z', '2026-11-02T16:48:08.461Z', '2026-10-26T00:00:00Z')`).run();
  const proposals = (d: Database.Database) => d.exec(`CREATE TABLE hos_proposals (id INTEGER, title TEXT, status TEXT, hsp_number INTEGER, created_at TEXT, approved_at TEXT,
      voting_ends_at TEXT, timelock_ends_at TEXT, votes_for TEXT, votes_against TEXT, votes_abstain TEXT, votes_total TEXT, quorum_required TEXT,
      quorum_met INTEGER, approval_met INTEGER, has_actions INTEGER, forum_url TEXT)`);
  const expiresOf = (d: Database.Database) => (d.prepare("SELECT expires_at FROM radar_items WHERE source_type = 'hos_vote'").get() as { expires_at: string }).expires_at;

  it('leaves the alerts of a source it could not read as they were', () => {
    const d = db();
    liveVote(d);
    const r = refreshRadar(d, NOW);
    expect(r.unread).toContain('hos_vote');
    expect(expiresOf(d)).toBe('2026-11-02T16:48:08.461Z');
  });

  it('retires an alert once its source no longer holds it, and writes what is true now', () => {
    const d = db();
    liveVote(d);
    proposals(d);
    d.prepare(`INSERT INTO hos_proposals VALUES (29, 'Ramp', 'Succeeded', 29, '2026-10-20T00:00:00Z', NULL, '2026-11-02T16:48:08.461Z', NULL, '1', '0', '0', '1', '1', 1, 1, 0, NULL)`).run();
    const r = refreshRadar(d, NOW);
    expect(r.retired).toBe(1);
    expect(expiresOf(d)).toBe(NOW.toISOString());
    expect((d.prepare("SELECT COUNT(*) n FROM radar_items WHERE source_type = 'event' AND expires_at > ?").get(NOW.toISOString()) as { n: number }).n).toBe(1);
  });

  it('retires a row of a source type the radar no longer produces', () => {
    const d = db();
    d.prepare(`INSERT INTO radar_items (level, title, source_type, source_id, published_at, expires_at, created_at)
      VALUES ('important', 'template', 'cip_change', 'x', '2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z', '2026-10-01T00:00:00Z')`).run();
    expect(refreshRadar(d, NOW).retired).toBe(1);
  });
});
