/**
 * NEAR protocol state for agents: which protocol version each network runs,
 * how the block producers are voting, and when the next upgrade's voting
 * starts according to the nearcore release that ships it.
 *
 * How an upgrade happens (nearcore chain/epoch-manager, read 2026-11-01, and
 * NEP ChainSpec/Upgradability): every block header carries
 * `latest_protocol_version`, the version its producer announces. At the end
 * of epoch T, the version announced by the most block-producer stake becomes
 * the version of epoch T+2 if that stake is strictly more than
 * `protocol_upgrade_stake_threshold` of the total block-producer stake. A
 * vote counts for its exact version only. So a vote that passes in T is
 * settled during T+1, where the fresh tally shows nothing new; the 2.14.0
 * notes put the switch 7-14 hours after the voting epoch ends. A node only starts announcing a new version at the voting start time
 * its release schedules, which is why 2.14.0 nodes on mainnet still announce
 * 86 although they support 88 (2026-11-01).
 */

import type Database from 'better-sqlite3';
import { compareVersions } from './release-version';
import { fenceUntrustedInline } from './untrusted-fence';

export interface VotingStep {
  version: number;
  /** ISO time voting for this version starts. */
  starts_at: string;
}

export interface UpgradeSchedule {
  release: string;
  release_url: string;
  published_at: string;
  from: number | null;
  to: number | null;
  steps: VotingStep[];
  /** The release's own words on when the switch follows a successful vote. */
  after_vote: string | null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * "Voting for protocol version 87 will start on Wednesday November 4th 00:00
 * UTC." The year is not written; it is the release's year, or the next one
 * when the month is earlier than the release's (a December release
 * scheduling January).
 */
export function parseUpgradeSchedule(body: string, publishedAt: string): Pick<UpgradeSchedule, 'from' | 'to' | 'steps' | 'after_vote'> | null {
  const text = body.replace(/\r/g, '');
  const section = text.match(/^#+\s*Protocol upgrade voting\s*\n([\s\S]*?)(?=^#{1,6}\s|$(?![\s\S]))/m)?.[1];
  if (!section) return null;
  const released = new Date(publishedAt);
  if (Number.isNaN(released.getTime())) return null;
  const range = section.match(/protocol version from (\d+) to (\d+)/i);
  const steps: VotingStep[] = [];
  for (const m of section.matchAll(/Voting for protocol version (\d+) (?:will )?(?:start|begin)s? (?:on )?(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*UTC/gi)) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    const [day, hour, minute] = [Number(m[3]), Number(m[4]), Number(m[5])];
    if (month < 0 || day < 1 || day > 31 || hour > 23 || minute > 59) continue;
    const year = month < released.getUTCMonth() ? released.getUTCFullYear() + 1 : released.getUTCFullYear();
    const at = new Date(Date.UTC(year, month, Number(m[3]), Number(m[4]), Number(m[5])));
    steps.push({ version: Number(m[1]), starts_at: at.toISOString() });
  }
  const after = section.match(/[^.\n]*expected to happen[^.\n]*\./i)?.[0].trim() ?? null;
  return { from: range ? Number(range[1]) : null, to: range ? Number(range[2]) : null, steps, after_vote: after };
}

/**
 * The schedule of the highest stable nearcore release that has one. By
 * version, not date: a backport to an older line can be published after the
 * newest release.
 */
export function latestUpgradeSchedule(db: Database.Database): UpgradeSchedule | null {
  const rows = (db.prepare(`SELECT tag, url, body, published_at FROM github_releases
      WHERE repo = 'near/nearcore' AND prerelease = 0 AND published_at IS NOT NULL AND body LIKE '%Protocol upgrade voting%'`).all() as
    Array<{ tag: string; url: string; body: string; published_at: string }>)
    .sort((a, b) => compareVersions(b.tag, a.tag))
    .slice(0, 3);
  for (const r of rows) {
    const s = parseUpgradeSchedule(r.body, r.published_at);
    if (s && s.steps.length) return { release: r.tag, release_url: r.url, published_at: r.published_at, ...s };
  }
  return null;
}

export interface Vote { account_id: string; version: number }
export interface Stake { account_id: string; stake: bigint; block_producer: boolean }

export interface Tally {
  /** Stake share of all block producers announcing each version, 0..1; `stake` is yoctoNEAR as a decimal string. */
  shares: Array<{ version: number; share: number; producers: number; stake: string }>;
  /** Total block-producer stake in yoctoNEAR, as a decimal string. */
  total_stake: string;
  /** Share of block-producer stake whose vote this epoch has been seen. */
  coverage: number;
  producers: number;
  producers_seen: number;
}

/**
 * Stake-weighted vote shares among block producers. The denominator is the
 * whole block-producer stake, seen or not, so a version can only be shown
 * over the threshold on votes actually observed; `coverage` says how much of
 * the stake those observations cover.
 */
export function tallyVotes(votes: readonly Vote[], stakes: readonly Stake[]): Tally {
  const producers = stakes.filter((s) => s.block_producer);
  const total = producers.reduce((a, s) => a + s.stake, BigInt(0));
  const stakeOf = new Map(producers.map((s) => [s.account_id, s.stake]));
  const byVersion = new Map<number, { stake: bigint; producers: number }>();
  let seen = BigInt(0);
  let producersSeen = 0;
  for (const v of votes) {
    const st = stakeOf.get(v.account_id);
    if (st === undefined) continue;
    seen += st;
    producersSeen++;
    const cur = byVersion.get(v.version) ?? { stake: BigInt(0), producers: 0 };
    byVersion.set(v.version, { stake: cur.stake + st, producers: cur.producers + 1 });
  }
  const share = (x: bigint) => (total === BigInt(0) ? 0 : Number((x * BigInt(1_000_000)) / total) / 1_000_000);
  return {
    shares: [...byVersion.entries()].sort((a, b) => b[0] - a[0]).map(([version, x]) => ({ version, share: share(x.stake), producers: x.producers, stake: x.stake.toString() })),
    total_stake: total.toString(),
    coverage: share(seen),
    producers: producers.length,
    producers_seen: producersSeen,
  };
}

/**
 * The version a tally carries past the threshold, as nearcore decides it:
 * strictly more than num/den of the total block-producer stake, compared in
 * integers so a vote at exactly 80% is not shown as passing.
 */
export function passingVersion(t: Tally, current: number, num: number | null, den: number | null): number | null {
  if (!num || !den) return null;
  const total = BigInt(t.total_stake);
  const hit = t.shares.find((s) => s.version > current && BigInt(s.stake) * BigInt(den) > total * BigInt(num));
  return hit?.version ?? null;
}

const FAILURE_REASON_MAX = 200;

export function sampleFailureNote(network: string, failed: number, samples: number, firstReason: string | null): string {
  const base = `${network}: ${failed} of ${samples} sampled blocks failed`;
  if (!firstReason) return base;
  return `${base}; first: ${firstReason.replace(/\s+/g, ' ').trim().slice(0, FAILURE_REASON_MAX)}`;
}

/**
 * Heights to sample between the last sampled height and the head, evenly
 * spaced. Producers rotate with height, so spread samples reach more of
 * them than the same number of consecutive blocks.
 */
export function sampleHeights(lastSampled: number | null, head: number, epochStart: number, max: number): number[] {
  const from = Math.max(lastSampled === null ? epochStart : lastSampled + 1, epochStart, head - 10_000);
  const span = head - from + 1;
  if (span <= 0) return [];
  if (span <= max) return Array.from({ length: span }, (_, i) => head - i);
  const step = span / max;
  return Array.from({ length: max }, (_, i) => head - Math.floor(i * step));
}

export interface Snapshot {
  network: string;
  observed_at: string;
  chain_id: string;
  protocol_version: number;
  latest_protocol_version: number;
  node_version: string | null;
  block_height: number;
  block_time: string;
  epoch_id: string;
  epoch_height: number | null;
  epoch_start_height: number;
  epoch_length: number | null;
  threshold_num: number | null;
  threshold_den: number | null;
  endpoint: string;
}

export function latestSnapshot(db: Database.Database, network: string): Snapshot | null {
  return (db.prepare('SELECT * FROM protocol_snapshots WHERE network = ? ORDER BY observed_at DESC LIMIT 1').get(network) as Snapshot | undefined) ?? null;
}

/** When the network first reported this protocol version, from our snapshots; null when it already ran it at our first look. */
export function versionSince(db: Database.Database, network: string, version: number): string | null {
  const first = db.prepare('SELECT MIN(observed_at) at FROM protocol_snapshots WHERE network = ?').get(network) as { at: string | null };
  const since = db.prepare('SELECT MIN(observed_at) at FROM protocol_snapshots WHERE network = ? AND protocol_version >= ?').get(network, version) as { at: string | null };
  return since.at && since.at !== first.at ? since.at : null;
}

export interface NetworkProtocol {
  snapshot: Snapshot;
  tally: Tally;
  /** The tally of the epoch before, whose vote decides the next epoch's version; null when we did not read it. */
  previous: { epoch_id: string; tally: Tally; passing: number | null } | null;
  /** Share of the epoch's blocks produced by `now`, 0..1, when the epoch length is known. */
  epoch_progress: number | null;
  /** Estimated seconds until the epoch ends, from `now` and the measured block rate. */
  seconds_left: number | null;
  /** Blocks a second between the last two snapshots, or 1 when they are too close to measure. */
  /** Blocks a second, measured from two observed blocks at least MIN_RATE_SPAN_S apart; null when there are none. */
  block_rate: number | null;
  threshold: number | null;
  /** The version this epoch's tally carries past the threshold, if any (decides the version two epochs on). */
  passing: number | null;
  /** Age of the snapshot at `now`, in seconds. */
  age_s: number;
}

/** Snapshots older than this are reported, and an "in effect" read from one is not trusted as "not yet". */
export const STALE_SNAPSHOT_S = 2 * 3600;

function tallyFor(db: Database.Database, network: string, epochId: string): Tally {
  const votes = db.prepare('SELECT account_id, voted_version AS version FROM validator_votes WHERE network = ? AND epoch_id = ?')
    .all(network, epochId) as Vote[];
  const stakes = (db.prepare('SELECT account_id, stake, block_producer FROM validator_stakes WHERE network = ? AND epoch_id = ?')
    .all(network, epochId) as Array<{ account_id: string; stake: string; block_producer: number }>)
    .map((x) => ({ account_id: x.account_id, stake: BigInt(x.stake), block_producer: x.block_producer === 1 }));
  return tallyVotes(votes, stakes);
}

const MIN_RATE_SPAN_S = 300;

/**
 * Blocks a second between this snapshot's head and an earlier block we
 * observed: the previous snapshot, or else the first block sampled for this
 * epoch's vote, so a fresh database with one snapshot still has a rate.
 */
function blockRate(db: Database.Database, network: string, snapshot: Snapshot): number | null {
  const candidates = [
    db.prepare(`SELECT block_height, block_time FROM protocol_snapshots WHERE network = ? AND observed_at < ?
      ORDER BY observed_at DESC LIMIT 1`).get(network, snapshot.observed_at),
    db.prepare(`SELECT block_height, block_time FROM validator_votes WHERE network = ? AND epoch_id = ?
      ORDER BY block_height ASC LIMIT 1`).get(network, snapshot.epoch_id),
  ] as Array<{ block_height: number; block_time: string } | undefined>;
  for (const c of candidates) {
    if (!c) continue;
    const dt = (Date.parse(snapshot.block_time) - Date.parse(c.block_time)) / 1000;
    if (dt >= MIN_RATE_SPAN_S && snapshot.block_height > c.block_height) return (snapshot.block_height - c.block_height) / dt;
  }
  return null;
}

export function networkProtocol(db: Database.Database, network: string, now: Date = new Date()): NetworkProtocol | null {
  const snapshot = latestSnapshot(db, network);
  if (!snapshot) return null;
  const tally = tallyFor(db, network, snapshot.epoch_id);
  const threshold = snapshot.threshold_num && snapshot.threshold_den ? snapshot.threshold_num / snapshot.threshold_den : null;

  const prevSnap = db.prepare('SELECT epoch_id, protocol_version FROM protocol_snapshots WHERE network = ? AND epoch_id != ? ORDER BY observed_at DESC LIMIT 1')
    .get(network, snapshot.epoch_id) as { epoch_id: string; protocol_version: number } | undefined;
  const prevTally = prevSnap ? tallyFor(db, network, prevSnap.epoch_id) : null;
  const previous = prevSnap && prevTally && prevTally.producers > 0
    ? { epoch_id: prevSnap.epoch_id, tally: prevTally, passing: passingVersion(prevTally, snapshot.protocol_version, snapshot.threshold_num, snapshot.threshold_den) }
    : null;

  const block_rate = blockRate(db, network, snapshot);
  const age_s = Math.max(0, (now.getTime() - Date.parse(snapshot.block_time)) / 1000);
  const heightNow = snapshot.block_height + Math.round(age_s * (block_rate ?? 0));
  const done = heightNow - snapshot.epoch_start_height;
  // Projected past the end of the epoch this snapshot read: that epoch is
  // over, and "100% through, 0m left" would describe one nobody is in.
  const length = snapshot.epoch_length ?? 0;
  const known = block_rate !== null && length > 0 && done < length;
  return {
    snapshot,
    tally,
    previous,
    epoch_progress: known ? Math.max(0, done / length) : null,
    seconds_left: known ? (length - done) / block_rate! : null,
    block_rate,
    threshold,
    passing: passingVersion(tally, snapshot.protocol_version, snapshot.threshold_num, snapshot.threshold_den),
    age_s: Math.max(0, (now.getTime() - Date.parse(snapshot.observed_at)) / 1000),
  };
}

export interface EffectOn {
  network: string;
  version: number | null;
  /** null when not observed, or when the last snapshot is too old to say "not yet". */
  in_effect: boolean | null;
  observed_at: string | null;
  /** When our snapshots first showed the version: an upper bound on when it took effect, not the moment itself. */
  first_observed: string | null;
  stale: boolean;
}

/**
 * Whether a change gated on a protocol version is live on each network. A
 * stale "yes" stands (versions only rise); a stale "not yet" is unknown,
 * since the upgrade may have happened while the sync was not running.
 */
export function effectOn(db: Database.Database, required: number, networks: readonly string[] = ['mainnet', 'testnet'], now: Date = new Date()): EffectOn[] {
  return networks.map((network) => {
    const s = latestSnapshot(db, network);
    if (!s) return { network, version: null, in_effect: null, observed_at: null, first_observed: null, stale: false };
    const stale = (now.getTime() - Date.parse(s.observed_at)) / 1000 > STALE_SNAPSHOT_S;
    const live = s.protocol_version >= required;
    return {
      network,
      version: s.protocol_version,
      in_effect: live ? true : stale ? null : false,
      observed_at: s.observed_at,
      first_observed: live ? versionSince(db, network, required) : null,
      stale,
    };
  });
}

/** One line per network for an entry gated on a protocol version, each with its own observation time. */
export function effectLine(effects: readonly EffectOn[], required: number): string {
  const parts = effects.map((e) => {
    if (e.version === null) return `${e.network}: not observed`;
    const at = `observed ${e.observed_at!.slice(0, 16)} UTC${e.stale ? ', STALE' : ''}`;
    if (e.in_effect === true) return `${e.network} runs ${e.version}, in effect${e.first_observed ? ` (first seen ${e.first_observed.slice(0, 16)} UTC)` : ''} [${at}]`;
    if (e.in_effect === null) return `${e.network} last seen on ${e.version}, current state unknown [${at}]`;
    return `${e.network} runs ${e.version}, not in effect yet [${at}]`;
  });
  return `Protocol ${required}: ${parts.join('; ')}`;
}

function duration(ms: number): string {
  const m = Math.round(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export interface ProtocolReport {
  networks: Array<NetworkProtocol & { pending_steps: VotingStep[]; waiting: Array<{ id: string; title: string; effective_protocol: number }> }>;
  schedule: UpgradeSchedule | null;
}

/**
 * The release notes schedule mainnet's voting; testnet runs release
 * candidates on dates of their own that the notes do not give, so its pending
 * steps are left empty rather than borrowed from mainnet.
 */
export function protocolReport(db: Database.Database, networks: readonly string[], now: Date = new Date()): ProtocolReport {
  const schedule = latestUpgradeSchedule(db);
  const waitingStmt = db.prepare('SELECT id, title, effective_protocol FROM deprecations WHERE effective_protocol > ? ORDER BY effective_protocol, id');
  const out: ProtocolReport['networks'] = [];
  for (const n of networks) {
    const p = networkProtocol(db, n, now);
    if (!p) continue;
    let waiting: Array<{ id: string; title: string; effective_protocol: number }> = [];
    try {
      waiting = waitingStmt.all(p.snapshot.protocol_version) as typeof waiting;
    } catch { /* no deprecations table yet */ }
    const steps = n === 'mainnet' ? schedule?.steps ?? [] : [];
    out.push({ ...p, pending_steps: steps.filter((s) => s.version > p.snapshot.protocol_version), waiting });
  }
  return { networks: out, schedule };
}

/** The report as text for an agent: our own reading of RPC and release notes, with the two strings taken verbatim from them (the node's version and the release notes' voting sentence) fenced as upstream text. */
export function renderProtocol(r: ProtocolReport, now: Date): string {
  if (r.networks.length === 0) return 'No protocol snapshot on this server yet: the protocol sync has not run.';
  const blocks = r.networks.map((n) => {
    const s = n.snapshot;
    const lines = [
      `## ${s.network} — protocol ${s.protocol_version}${s.latest_protocol_version > s.protocol_version ? ` (its nodes support up to ${s.latest_protocol_version})` : ''}`,
      `nearcore ${s.node_version ? fenceUntrustedInline(s.node_version) : '?'} at ${s.endpoint}, block ${s.block_height} (${s.block_time.slice(0, 19)} UTC), observed ${s.observed_at.slice(0, 16)} UTC${n.age_s > STALE_SNAPSHOT_S ? ` — STALE: ${duration(n.age_s * 1000)} old, the sync has not refreshed it` : ''}.`,
    ];
    if (n.epoch_progress !== null && n.seconds_left !== null) {
      lines.push(`Epoch ${s.epoch_height ?? '?'}: about ${pct(n.epoch_progress)} through now, roughly ${duration(n.seconds_left * 1000)} left at ${n.block_rate!.toFixed(2)} blocks a second.`);
    }
    if (n.previous?.passing) {
      lines.push(`The previous epoch's vote carried ${n.previous.passing} past the threshold (${pct(n.previous.tally.shares.find((x) => x.version === n.previous!.passing)!.share)} of block-producer stake, read from ${pct(n.previous.tally.coverage)}): the switch is decided and is expected when this epoch ends.`);
    }
    const shares = n.tally.shares.map((x) => `${x.version}: ${pct(x.share)} (${x.producers} producers)`).join(', ') || 'no votes read yet';
    lines.push(`Upgrade vote this epoch, by block-producer stake: ${shares}. Read from ${n.tally.producers_seen} of ${n.tally.producers} producers, ${pct(n.tally.coverage)} of their stake.`);
    const nothingNewer = s.latest_protocol_version <= s.protocol_version && n.pending_steps.length === 0 && n.passing === null && !n.previous?.passing;
    if (nothingNewer) {
      lines.push(s.network === 'mainnet'
        ? 'No newer protocol version is supported by its nodes or scheduled in the synced release notes.'
        : 'No newer protocol version is supported by its nodes. (Release notes schedule mainnet only.)');
    } else if (n.threshold !== null) {
      lines.push(n.passing !== null
        ? `${n.passing} has more than ${s.threshold_num}/${s.threshold_den} of the stake in what was read: if that holds to the end of this epoch, the network switches to it one epoch later.`
        : `An upgrade needs strictly more than ${s.threshold_num}/${s.threshold_den} (${pct(n.threshold)}) of block-producer stake announcing the same new version within one epoch; it then applies two epochs on.`);
    }
    for (const step of n.pending_steps) {
      const t = Date.parse(step.starts_at) - now.getTime();
      lines.push(`Voting for ${step.version} ${t > 0 ? `starts ${step.starts_at.slice(0, 16)} UTC, in ${duration(t)}` : `started ${step.starts_at.slice(0, 16)} UTC`}.`);
    }
    if (n.waiting.length) lines.push(`Waiting on these upgrades: ${n.waiting.map((w) => `${w.title} (protocol ${w.effective_protocol}; check_deprecation("${w.id}"))`).join('; ')}.`);
    return lines.join('\n');
  });
  const src = r.schedule ? `Mainnet schedule from nearcore ${r.schedule.release} release notes (${r.schedule.release_url})${r.schedule.after_vote ? `: ${fenceUntrustedInline(r.schedule.after_vote)}` : '.'}` : 'No upgrade schedule found in the synced nearcore release notes.';
  return [...blocks, src].join('\n\n');
}
