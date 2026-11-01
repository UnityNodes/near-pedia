/**
 * The NEAR Radar: what is changing now and needs someone to act, each item
 * with the date it stops being true.
 *
 * Every item is derived from state the syncs already hold, and its expiry is
 * the end of that state, not a fixed 30 or 90 days from publication: the
 * radar this engine came from served a closed validator vote for weeks
 * because the item outlived its subject. An item lives while
 *
 *   protocol_upgrade  the network runs a lower protocol version than the
 *                     latest nearcore release schedules or the validators
 *                     vote for; ends when the versions are equal
 *   node_release      the newest stable nearcore is a CODE_RED or security
 *                     release; ends when a newer one ships, 30 days at most
 *   hos_vote          a House of Stake proposal is in Voting; ends with the vote
 *   hos_timelock      a passed proposal sits in its timelock; ends with it
 *   hsp_draft         a gov.near.org HSP thread has no on-chain proposal yet;
 *                     ends when it goes on chain or after 30 quiet days
 *   incident          a NEAR security incident; ends 30 days after the hack.
 *                     The spec asked for "post-mortem + 30 days", and no
 *                     source here says when a post-mortem was published
 *   event             a dated ecosystem event (lib/radar-events.ts); ends at
 *                     its date
 *
 * refresh-radar writes the current set and retires every live item the set
 * no longer contains, so a resolved item ends on the next run rather than at
 * its estimated date. Only the sources actually read on the run are retired:
 * a table missing after a deploy says nothing about whether its alerts still
 * hold. check-radar-expiry asserts both halves.
 *
 * A protocol alert lives no longer than its snapshot is fresh: if
 * sync-protocol stops, the network may have upgraded without us seeing it,
 * and a stale "upgrade pending" is the very alert this radar must not show.
 */

import type Database from 'better-sqlite3';
import { protocolReport, STALE_SNAPSHOT_S, type ProtocolReport } from './protocol';
import { HSP_CATEGORY_IDS, hspNumber, isDraft, titleKey } from './gov-forum';
import { compareVersions } from './release-version';
import { percent, veNear } from './house-of-stake';
import { usd } from './incidents';
import { RADAR_EVENTS, type RadarEvent } from './radar-events';

export type RadarLevel = 'critical' | 'important' | 'ecosystem';

export const RADAR_SOURCE_TYPES = ['protocol_upgrade', 'node_release', 'hos_vote', 'hos_timelock', 'hsp_draft', 'incident', 'event'] as const;
export type RadarSourceType = (typeof RADAR_SOURCE_TYPES)[number];

export interface RadarCandidate {
  sourceType: RadarSourceType;
  sourceId: string;
  level: RadarLevel;
  title: string;
  body: string;
  url: string;
  publishedAt: string;
  /** When the action is due, if there is one. */
  deadline: string | null;
  /** When the item stops being true at the latest. Never null. */
  expiresAt: string;
  affects: string[];
}

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();
const ms = (at: string | null | undefined) => (at ? Date.parse(at) : Number.NaN);
/** null for a date that does not parse: one bad row is skipped, it does not stop the refresh. */
const plusDays = (at: string, days: number): string | null => (Number.isFinite(ms(at)) ? iso(ms(at) + days * DAY) : null);

/** An item whose upgrade is waiting on a vote gets this long past the last scheduled step before it lapses unresolved. */
export const UPGRADE_GRACE_DAYS = 14;
/** A protocol alert ends this long after the snapshot it was read from, unless a fresher one renews it. */
export const PROTOCOL_ALERT_TTL_MS = 2 * STALE_SNAPSHOT_S * 1000;
/** Votes alone (no release scheduling the version) raise an alert only from this share of block-producer stake: one stray node is not an upgrade. */
export const MIN_VOTE_SHARE = 0.1;
export const NODE_RELEASE_DAYS = 30;
export const DRAFT_QUIET_DAYS = 30;
export const INCIDENT_DAYS = 30;

export function protocolItems(report: ProtocolReport, now: Date): RadarCandidate[] {
  const out: RadarCandidate[] = [];
  const schedule = report.schedule;
  for (const n of report.networks) {
    const current = n.snapshot.protocol_version;
    const above = n.tally.shares.filter((v) => v.version > current && v.share > 0);
    const voted = Math.max(0, ...above.filter((v) => v.share >= MIN_VOTE_SHARE).map((v) => v.version));
    const scheduled = n.snapshot.network === 'mainnet' && schedule?.to !== null && schedule?.to !== undefined ? schedule.to : 0;
    const target = Math.max(voted, scheduled, n.passing ?? 0);
    if (target <= current) continue;
    const steps = n.pending_steps;
    const next = steps.find((s) => Date.parse(s.starts_at) > now.getTime()) ?? null;
    const last = steps.length ? ms(steps[steps.length - 1].starts_at) : Number.NaN;
    const fresh = ms(n.snapshot.observed_at) + PROTOCOL_ALERT_TTL_MS;
    const lapse = Number.isFinite(last) ? Math.min(last + UPGRADE_GRACE_DAYS * DAY, fresh) : fresh;
    if (!Number.isFinite(lapse) || lapse <= now.getTime()) continue;
    const support = above.map((v) => `${v.version}: ${(v.share * 100).toFixed(1)}% of stake`).join(', ');
    const threshold = n.threshold !== null ? `${(n.threshold * 100).toFixed(0)}%` : 'the RPC threshold';
    const lines = [
      `${n.snapshot.network} runs protocol ${current}; ${schedule && n.snapshot.network === 'mainnet' ? `nearcore ${schedule.release} moves it to ${schedule.to}` : `validators vote for ${target}`}.`,
      `Block-producer votes this epoch: ${support || 'none above the current version yet'}; a version needs more than ${threshold} of stake.`,
      n.passing ? `Protocol ${n.passing} has passed the threshold and takes effect two epochs on.` : '',
      steps.length ? `Voting steps: ${steps.map((s) => `${s.version} from ${s.starts_at.slice(0, 16)} UTC`).join(', ')}.` : '',
      n.age_s > STALE_SNAPSHOT_S ? `Read from a snapshot ${Math.round(n.age_s / 3600)} h old.` : '',
      n.snapshot.network === 'mainnet' ? 'Validators and RPC node operators must run the new nearcore before voting starts; contracts relying on removed features break at the switch (get_protocol_status lists them).' : '',
    ].filter(Boolean);
    out.push({
      sourceType: 'protocol_upgrade',
      sourceId: `${n.snapshot.network}:${current}`,
      level: n.snapshot.network === 'mainnet' ? 'critical' : 'important',
      title: `Protocol upgrade ${current} → ${target} on ${n.snapshot.network}`,
      body: lines.join(' '),
      url: n.snapshot.network === 'mainnet' && schedule ? schedule.release_url : 'https://github.com/near/nearcore/releases',
      publishedAt: schedule?.published_at ?? n.snapshot.observed_at,
      deadline: next?.starts_at ?? null,
      expiresAt: iso(lapse),
      affects: ['validator', 'node-operator', 'developer'],
    });
  }
  return out;
}

export interface NodeRelease { tag: string; url: string; published_at: string; body: string | null }

/** nearcore puts CODE_COLOR and SECURITY_UPGRADE in a block at the top of every release, one per line. */
export function releaseUrgency(body: string | null): { code: string | null; security: boolean } {
  const code = body?.match(/^\s*CODE_COLOR:\s*(CODE_[A-Z_]+)\s*$/m)?.[1] ?? null;
  return { code, security: /^\s*SECURITY_UPGRADE:\s*TRUE\s*$/im.test(body ?? '') };
}

/**
 * The newest stable release by version, not by date: a backport on an older
 * line published after a CODE_RED release must not hide it. Only mainnet
 * codes count; CODE_RED_TESTNET concerns testnet operators.
 */
export function nodeReleaseItems(stable: readonly NodeRelease[], now: Date): RadarCandidate[] {
  const newest = [...stable].filter((r) => /^\d+\.\d+\.\d+$/.test(r.tag)).sort((a, b) => compareVersions(b.tag, a.tag))[0];
  if (!newest) return [];
  const { code, security } = releaseUrgency(newest.body);
  if (!security && code !== 'CODE_RED_MAINNET') return [];
  const expiresAt = plusDays(newest.published_at, NODE_RELEASE_DAYS);
  if (!expiresAt || ms(expiresAt) <= now.getTime()) return [];
  return [{
    sourceType: 'node_release',
    sourceId: newest.tag,
    level: 'critical',
    title: `nearcore ${newest.tag}: ${security ? 'security release' : code}`,
    body: `nearcore ${newest.tag} is marked ${[code, security ? 'SECURITY_UPGRADE' : ''].filter(Boolean).join(' and ')}: node operators should upgrade now.`,
    url: newest.url,
    publishedAt: newest.published_at,
    deadline: null,
    expiresAt,
    affects: ['validator', 'node-operator'],
  }];
}

export interface ProposalState {
  id: number;
  title: string;
  status: string;
  hsp_number: number | null;
  created_at: string;
  approved_at: string | null;
  voting_ends_at: string | null;
  timelock_ends_at: string | null;
  votes_for: string;
  votes_against: string;
  votes_abstain: string;
  votes_total: string;
  quorum_required: string | null;
  quorum_met: number | null;
  approval_met: number | null;
  has_actions: number;
  forum_url: string | null;
}

const proposalUrl = (id: number) => `https://near.org/proposal/${id}`;
const hspLabel = (p: ProposalState) => (p.hsp_number !== null ? `HSP-${String(p.hsp_number).padStart(3, '0')}` : `proposal #${p.id}`);

export function proposalItems(proposals: readonly ProposalState[], now: Date): RadarCandidate[] {
  const out: RadarCandidate[] = [];
  const t = now.getTime();
  for (const p of proposals) {
    if (p.status === 'Voting' && ms(p.voting_ends_at) > t) {
      const forAgainst = BigInt(p.votes_for) + BigInt(p.votes_against);
      out.push({
        sourceType: 'hos_vote',
        sourceId: String(p.id),
        level: 'important',
        title: `House of Stake vote: ${hspLabel(p)}, ${p.title}`,
        body: `Voting ends ${p.voting_ends_at!.slice(0, 16)} UTC. For ${veNear(p.votes_for)} veNEAR (${percent(p.votes_for, forAgainst.toString())} of For+Against), against ${veNear(p.votes_against)}, abstain ${veNear(p.votes_abstain)}; quorum ${veNear(p.quorum_required)} ${p.quorum_met ? 'met' : 'not met yet'}.`,
        url: p.forum_url ?? proposalUrl(p.id),
        publishedAt: p.approved_at ?? p.created_at,
        deadline: p.voting_ends_at,
        expiresAt: p.voting_ends_at!,
        affects: ['venear-holder', 'validator'],
      });
    }
    if (p.status === 'Timelock' && ms(p.timelock_ends_at) > t) {
      out.push({
        sourceType: 'hos_timelock',
        sourceId: String(p.id),
        level: p.has_actions ? 'important' : 'ecosystem',
        title: `House of Stake ${hspLabel(p)} passed, in timelock: ${p.title}`,
        body: `The vote passed; ${p.has_actions ? 'its on-chain actions execute' : 'it is final'} after the timelock ends ${p.timelock_ends_at!.slice(0, 16)} UTC unless vetoed.`,
        url: p.forum_url ?? proposalUrl(p.id),
        publishedAt: p.voting_ends_at ?? p.created_at,
        deadline: p.timelock_ends_at,
        expiresAt: p.timelock_ends_at!,
        affects: ['venear-holder'],
      });
    }
  }
  return out;
}

export interface ForumThread { id: number; title: string; url: string; created_at: string | null; last_post_at: string | null }

/**
 * A gov.near.org HSP thread with no on-chain proposal: a draft
 * ("DRAFT HSP-XXX: …") or a numbered HSP not yet submitted to vote.dao.
 * Withdrawn threads are not drafts. A "DRAFT HSP-XXX: Foo" has no number to
 * match, so it is also matched to the on-chain titles by titleKey, the way
 * sync-hos links a proposal to its thread.
 */
export function draftItems(threads: readonly ForumThread[], onChainHsp: ReadonlySet<number>, now: Date, onChainTitles: ReadonlySet<string> = new Set()): RadarCandidate[] {
  const out: RadarCandidate[] = [];
  for (const th of threads) {
    if (/^\s*[([]?\s*withdrawn\b/i.test(th.title)) continue;
    const n = hspNumber(th.title);
    const draft = isDraft(th.title) && /\bHSP\b/i.test(th.title);
    if (n === null && !draft) continue;
    if (n !== null && onChainHsp.has(n)) continue;
    if (onChainTitles.has(titleKey(th.title))) continue;
    const lastActive = th.last_post_at ?? th.created_at;
    if (!lastActive) continue;
    const expiresAt = plusDays(lastActive, DRAFT_QUIET_DAYS);
    if (!expiresAt || ms(expiresAt) <= now.getTime()) continue;
    out.push({
      sourceType: 'hsp_draft',
      sourceId: String(th.id),
      level: 'ecosystem',
      title: `HSP draft on gov.near.org: ${th.title}`,
      body: `Discussed on gov.near.org, not yet a vote.dao proposal. Last post ${lastActive.slice(0, 10)}.`,
      url: th.url,
      publishedAt: th.created_at ?? lastActive,
      deadline: null,
      expiresAt,
      affects: ['venear-holder'],
    });
  }
  return out;
}

export interface IncidentState { id: string; name: string; date: string; amount_usd: number | null; technique: string | null; source_url: string; relevance: string; catalog_slug: string | null }

export function incidentItems(incidents: readonly IncidentState[], now: Date): RadarCandidate[] {
  return incidents
    .filter((i) => i.relevance === 'near')
    .map((i) => ({ i, expiresAt: plusDays(`${i.date}T00:00:00.000Z`, INCIDENT_DAYS) }))
    .filter((x): x is { i: IncidentState; expiresAt: string } => x.expiresAt !== null && ms(x.expiresAt) > now.getTime())
    .map(({ i, expiresAt }) => ({
      sourceType: 'incident' as const,
      sourceId: i.id,
      level: 'critical' as const,
      title: `Security incident: ${i.name}, ${usd(i.amount_usd)} (${i.date})`,
      body: `${i.technique ? `${i.technique}. ` : ''}Check integrations with ${i.catalog_slug ?? i.name} before relying on it; get_incident ${i.id} has DefiLlama's account.`,
      url: i.source_url,
      publishedAt: `${i.date}T00:00:00.000Z`,
      deadline: null,
      expiresAt,
      affects: ['developer'],
    }));
}

export function eventItems(events: readonly RadarEvent[], now: Date): RadarCandidate[] {
  return events
    .filter((e) => ms(e.at) > now.getTime())
    .map((e) => ({
      sourceType: 'event' as const,
      sourceId: e.id,
      level: e.level,
      title: e.title,
      body: e.body,
      url: e.url,
      publishedAt: e.announced_at,
      deadline: e.at,
      expiresAt: e.at,
      affects: e.affects,
    }));
}

export interface RadarRead {
  items: RadarCandidate[];
  /** The source types whose tables were read on this run; only these may be retired. */
  read: Set<RadarSourceType>;
}

/** Every radar item that is true now, read from the synced tables, and which sources could be read at all. */
export function collectRadar(db: Database.Database, now: Date = new Date()): RadarRead {
  const read = new Set<RadarSourceType>();
  const from = <T>(types: readonly RadarSourceType[], f: () => T, empty: T): T => {
    try {
      const out = f();
      for (const t of types) read.add(t);
      return out;
    } catch (e) {
      if (/no such (table|column)/.test((e as Error).message)) return empty;
      throw e;
    }
  };
  const report = from(['protocol_upgrade'], () => protocolReport(db, ['mainnet', 'testnet'], now), { networks: [], schedule: null } as ProtocolReport);
  const releases = from(['node_release'], () => db.prepare(`SELECT tag, url, published_at, body FROM github_releases
    WHERE repo = 'near/nearcore' AND prerelease = 0 AND published_at IS NOT NULL
    ORDER BY published_at DESC LIMIT 20`).all() as NodeRelease[], []);
  const proposals = from(['hos_vote', 'hos_timelock'], () => db.prepare(`SELECT id, title, status, hsp_number, created_at, approved_at, voting_ends_at, timelock_ends_at,
      votes_for, votes_against, votes_abstain, votes_total, quorum_required, quorum_met, approval_met, has_actions, forum_url
    FROM hos_proposals WHERE status IN ('Voting', 'Timelock')`).all() as ProposalState[], []);
  const { onChain, threads } = from(['hsp_draft'], () => ({
    onChain: db.prepare('SELECT hsp_number n, title FROM hos_proposals').all() as Array<{ n: number | null; title: string }>,
    threads: db.prepare(`SELECT id, title, url, created_at, last_post_at FROM forum_topics
      WHERE category_id IN (${HSP_CATEGORY_IDS.join(',')}) AND title LIKE '%HSP%' AND COALESCE(last_post_at, created_at) > ?`).all(iso(now.getTime() - DRAFT_QUIET_DAYS * DAY)) as ForumThread[],
  }), { onChain: [] as Array<{ n: number | null; title: string }>, threads: [] as ForumThread[] });
  const incidents = from(['incident'], () => db.prepare(`SELECT id, name, date, amount_usd, technique, source_url, relevance, catalog_slug FROM incidents
    WHERE relevance = 'near' AND date > ?`).all(iso(now.getTime() - INCIDENT_DAYS * DAY).slice(0, 10)) as IncidentState[], []);
  read.add('event');
  const items = [
    ...protocolItems(report, now),
    ...nodeReleaseItems(releases, now),
    ...proposalItems(proposals, now),
    ...draftItems(threads, new Set(onChain.flatMap((r) => (r.n === null ? [] : [r.n]))), now, new Set(onChain.map((r) => titleKey(r.title)).filter(Boolean))),
    ...incidentItems(incidents, now),
    ...eventItems(RADAR_EVENTS, now),
  ];
  return { items, read };
}
