import { config } from 'dotenv';
import { guardSync, logRun } from '../lib/sync-log';
import { prune } from '../lib/prune';
config({ path: '.env.local' });

import { getDb } from '../lib/db';
import { capText } from '../lib/cap-text';
import { descriptionFromWatchPage } from '../lib/video-description';
import { VIDEO_CHANNELS } from '../lib/video-channels';
import { NEXT_URL, NOT_YET_PUBLISHED, nextRequestBody, parseNext } from '../lib/youtube-next';

const CHANNELS = VIDEO_CHANNELS;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DISCOVER_DELAY_MS = 300; // between paginated browse calls
const ENRICH_DELAY_MS = 800; // between per-video watch-page fetches
const MAX_DISCOVER_PAGES = 30; // hard cap so a renderer change can't infinite-loop
const MAX_ENRICH_FAILS_BEFORE_ABORT = 8; // bail the enrich pass on a hard rate-limit
const REFRESH_DELAY_MS = 3000;
const REFRESH_ABORT_AFTER = 4;
const WEB_CLIENT_VERSION = '2.20260606.02.00';
/** Held videos still without a description or a publish date that one run tries to complete, newest first. */
const BACKFILL_PER_RUN = Number(process.env.YOUTUBE_BACKFILL ?? 300);

// A discovered video. title comes straight from the playlist/browse JSON
// (lockupViewModel.title.content), so rows can be written even when the
// per-video watch page is unavailable (e.g. YouTube 429s this server IP).
interface DiscoveredVideo {
  id: string;
  title: string;
}

function unescapeJson(s: string | null | undefined): string | null {
  if (!s) return null;
  return s
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\\\/g, '\\')
    .replace(/\\\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// Parse lockupViewModel blocks (the current playlist/browse item renderer).
// Each block pairs a contentId (videoId) with title.content. Returns the
// first title seen per id (most-recent uploads first).
function extractLockupVideos(text: string): DiscoveredVideo[] {
  const out: DiscoveredVideo[] = [];
  const seen = new Set<string>();
  const blocks = text.split('"lockupViewModel":');
  for (let i = 1; i < blocks.length; i++) {
    const seg = blocks[i];
    const idMatch = seg.match(/"contentId":"([A-Za-z0-9_-]{11})"/);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (seen.has(id)) continue;
    const titleMatch = seg.match(
      /"lockupMetadataViewModel":\{"title":\{"content":"((?:[^"\\]|\\.)*)"/,
    );
    const title = unescapeJson(titleMatch?.[1] ?? null);
    if (!title) continue;
    seen.add(id);
    out.push({ id, title });
  }
  return out;
}

function extractContinuationToken(text: string): string | null {
  return text.match(/"continuationCommand":\{"token":"([^"]+)"/)?.[1] ?? null;
}

interface DiscoveredChannel {
  videos: DiscoveredVideo[];
  // False when the walk stopped with part of the playlist unseen (a failed
  // page, an unparseable page, the page cap). A prune over an unfinished walk
  // deletes videos that are simply further down the list.
  complete: boolean;
}

// Walk a channel's uploads playlist (UU... derived from UC...) via innertube
// browse pagination and return every videoId + title found, oldest videos
// included. Falls back gracefully if the channel page can't be parsed.
async function discoverChannelVideos(channelId: string): Promise<DiscoveredChannel> {
  const playlistId = 'UU' + channelId.slice(2);
  const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}&hl=en&gl=US`;

  let html: string;
  try {
    const res = await fetch(playlistUrl, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    console.warn(`  playlist fetch failed for ${channelId}: ${(err as Error).message}`);
    return { videos: [], complete: false };
  }

  const ctxMatch = html.match(/"INNERTUBE_CONTEXT":(\{[\s\S]+?\}),"INNERTUBE_CONTEXT_CLIENT_NAME"/);
  if (!ctxMatch) {
    console.warn(`  no INNERTUBE_CONTEXT for ${channelId}`);
    return { videos: [], complete: false };
  }
  let context: { client?: { clientVersion?: string } };
  try {
    context = JSON.parse(ctxMatch[1]);
  } catch (err) {
    console.warn(`  context parse failed for ${channelId}: ${(err as Error).message}`);
    return { videos: [], complete: false };
  }
  const clientVersion = context.client?.clientVersion ?? WEB_CLIENT_VERSION;

  const byId = new Map<string, DiscoveredVideo>();
  for (const v of extractLockupVideos(html)) if (!byId.has(v.id)) byId.set(v.id, v);
  let cont = extractContinuationToken(html);
  let page = 1;
  let complete = true;

  while (cont && page < MAX_DISCOVER_PAGES) {
    page++;
    const sizeBefore = byId.size;
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': UA,
          'X-Youtube-Client-Name': '1',
          'X-Youtube-Client-Version': clientVersion,
          Origin: 'https://www.youtube.com',
        },
        body: JSON.stringify({ context, continuation: cont }),
      });
      // Stopped early with a continuation still outstanding: there is more of
      // this playlist that was not seen.
      if (!res.ok) { complete = false; break; }
      const body = await res.text();
      for (const v of extractLockupVideos(body)) if (!byId.has(v.id)) byId.set(v.id, v);
      if (byId.size === sizeBefore) break; // page returned nothing new
      cont = extractContinuationToken(body);
    } catch (err) {
      console.warn(`  browse page ${page} failed: ${(err as Error).message}`);
      complete = false;
      break;
    }
    await sleep(DISCOVER_DELAY_MS);
  }
  if (cont && page >= MAX_DISCOVER_PAGES) complete = false;

  return { videos: [...byId.values()], complete };
}

/**
 * Is this video still watchable by anyone with the link?
 *
 * The uploads playlist lists a channel's PUBLIC videos. An unlisted one is
 * absent from it and perfectly alive, so "the walk did not return it" is not
 * grounds to delete. oEmbed answers from a datacenter IP, which the watch page
 * does not: 200 for public and unlisted, 403 for private, 404 for removed.
 */
async function stillWatchable(id: string): Promise<boolean> {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return true;
    if (res.status === 403 || res.status === 404) return false;
    // Anything else (429, 5xx) is our problem, not the video's. Keep the row.
    console.warn(`  oembed ${res.status} for ${id}: treating as alive`);
    return true;
  } catch (err) {
    console.warn(`  oembed failed for ${id}: ${(err as Error).message}: treating as alive`);
    return true;
  }
}

interface EnrichedMetadata {
  title: string | null;
  description: string | null;
  published_at: string | null;
}

function parsePublishDate(s: string | null): string | null {
  if (!s || NOT_YET_PUBLISHED.test(s)) return null;
  const d = new Date(s);
  if (isNaN(d.getTime()) || d.getTime() > Date.now()) return null;
  return d.toISOString();
}

let watchPageRefused = false;

async function enrichFromNext(id: string): Promise<EnrichedMetadata | null> {
  try {
    const res = await fetch(NEXT_URL, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'X-Youtube-Client-Name': '1', 'X-Youtube-Client-Version': WEB_CLIENT_VERSION },
      body: nextRequestBody(id, WEB_CLIENT_VERSION),
    });
    if (!res.ok) return null;
    const meta = parseNext(await res.json() as Record<string, unknown>);
    return { ...meta, description: meta.description ? capText(meta.description, 20_000) : null };
  } catch {
    return null;
  }
}

// Best-effort: pull description + publishDate (and a cleaner title) from a
// video's watch page. No JS evaluation — patterns target the embedded JSON.
// Once the watch page refuses this server (a 302 to a sign-in check, a 429),
// the rest of the run asks the innertube `next` endpoint instead
// (lib/youtube-next.ts). Returns null when neither answers; callers fall back
// to the discovery title so the row is still written.
async function enrichVideo(id: string): Promise<EnrichedMetadata | null> {
  if (watchPageRefused) return enrichFromNext(id);
  const fromWatch = await enrichFromWatchPage(id);
  if (fromWatch?.description) return fromWatch;
  if (!fromWatch) watchPageRefused = true;
  return (await enrichFromNext(id)) ?? fromWatch;
}

async function enrichFromWatchPage(id: string): Promise<EnrichedMetadata | null> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en&gl=US`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'manual',
    });
    if (!res.ok) return null;
    const html = await res.text();

    const title = unescapeJson(
      html.match(/"videoPrimaryInfoRenderer":\{[^{]{0,200}"title":\{"runs":\[\{"text":"([^"]+)"/)?.[1] ?? null,
    );

    const description = descriptionFromWatchPage(html);
    const publishedRaw = html.match(/"publishDate":\{"simpleText":"([^"]+)"/)?.[1] ?? null;
    const published_at = parsePublishDate(publishedRaw);

    return {
      title,
      description: description ? capText(description, 20_000) : null,
      published_at,
    };
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchFeedIds(channelId: string): Promise<string[] | null> {
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const xml = await res.text();
    return [...xml.matchAll(/<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/g)].map((m) => m[1]);
  } catch {
    return null;
  }
}

async function refreshDescriptions(): Promise<void> {
  const db = getDb();
  const rows = db.prepare('SELECT id, description FROM youtube_videos ORDER BY published_at DESC').all() as { id: string; description: string | null }[];
  const update = db.prepare('UPDATE youtube_videos SET description = ? WHERE id = ?');
  let changed = 0;
  let failed = 0;
  let refused = 0;
  for (let i = 0; i < rows.length; i++) {
    const meta = await enrichVideo(rows[i].id);
    refused = meta ? 0 : refused + 1;
    if (refused >= REFRESH_ABORT_AFTER) {
      console.log(`  ${refused} watch pages in a row were refused: YouTube is limiting this address. Stopping at ${i + 1}/${rows.length}; run it again later.`);
      break;
    }
    if (!meta || !meta.description) {
      failed++;
      console.log(`  [${i + 1}/${rows.length}] ${rows[i].id} - no description read (kept as is)`);
    } else if (meta.description !== rows[i].description) {
      update.run(meta.description, rows[i].id);
      changed++;
      console.log(`  [${i + 1}/${rows.length}] ${rows[i].id} - description updated`);
    }
    await sleep(REFRESH_DELAY_MS);
  }
  console.log(`\nDone. Updated: ${changed}, unreadable: ${failed}, unchanged: ${rows.length - changed - failed}`);
}

/**
 * Enrichment only ever ran on videos new to this run, so a video first
 * written while YouTube refused this server kept its bare title for good.
 * Each run now also completes up to BACKFILL_PER_RUN held videos that still
 * have no description.
 */
async function backfillDescriptions(db: ReturnType<typeof getDb>): Promise<{ enriched: number; left: number }> {
  // description NULL: never read. '' : read, and the video has none, so it is not asked again.
  const missing = () => (db.prepare('SELECT COUNT(*) n FROM youtube_videos WHERE description IS NULL').get() as { n: number }).n;
  const now = new Date().toISOString();
  const rows = db.prepare(`SELECT id FROM youtube_videos WHERE description IS NULL OR published_at IS NULL OR published_at > ?
    ORDER BY published_at IS NULL, published_at DESC, rowid DESC LIMIT ?`).all(now, BACKFILL_PER_RUN) as { id: string }[];
  if (rows.length === 0) return { enriched: 0, left: 0 };
  const update = db.prepare(`UPDATE youtube_videos SET
    description = CASE WHEN description IS NULL OR @description <> '' THEN @description ELSE description END,
    published_at = CASE WHEN published_at IS NULL OR published_at > @now THEN @published_at ELSE published_at END,
    title = COALESCE(@title, title), synced_at = @now WHERE id = @id`);
  console.log(`\n=== Backfill: ${rows.length} held video(s) without a description or a publish date ===`);
  let enriched = 0;
  let fails = 0;
  for (const { id } of rows) {
    if (fails >= MAX_ENRICH_FAILS_BEFORE_ABORT) {
      console.warn(`  backfill stopped after ${fails} consecutive failures`);
      break;
    }
    const meta = await enrichVideo(id);
    if (meta) {
      update.run({ id, description: meta.description ?? '', published_at: meta.published_at, title: meta.title, now });
      if (meta.description) enriched++;
      fails = 0;
    } else {
      fails++;
    }
    await sleep(ENRICH_DELAY_MS);
  }
  console.log(`  backfilled ${enriched} description(s)`);
  return { enriched, left: missing() };
}

async function main(): Promise<void> {
  const db = getDb();

  // channel_name column is added by initSchema migration; safe to use here.
  const existingIds = new Set(
    (db.prepare('SELECT id FROM youtube_videos').all() as { id: string }[]).map((r) => r.id),
  );

  const insertStmt = db.prepare(`
    INSERT INTO youtube_videos (id, title, description, published_at, url, thumbnail_url, channel_name, synced_at)
    VALUES (@id, @title, @description, @published_at, @url, @thumbnail_url, @channel_name, @synced_at)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = COALESCE(excluded.description, youtube_videos.description),
      published_at = COALESCE(excluded.published_at, youtube_videos.published_at),
      thumbnail_url = excluded.thumbnail_url,
      channel_name = excluded.channel_name,
      synced_at = excluded.synced_at
  `);

  let totalDiscovered = 0;
  let totalWritten = 0;
  let totalEnriched = 0;
  let totalEnrichFailed = 0;
  const problems: string[] = [];

  for (const channel of CHANNELS) {
    console.log(`\n=== ${channel.name} (${channel.id}) ===`);
    const { videos, complete } = await discoverChannelVideos(channel.id);
    totalDiscovered += videos.length;
    const newVideos = videos.filter((v) => !existingIds.has(v.id));
    console.log(`  discovered ${videos.length} videos, ${newVideos.length} new`);
    const heldHere = (db.prepare('SELECT COUNT(*) AS n FROM youtube_videos WHERE channel_name = ?').get(channel.name) as { n: number }).n;
    if (videos.length === 0 && heldHere > 0) {
      problems.push(`${channel.name}: the uploads walk found no videos although ${heldHere} are held`);
    }

    const insertMany = db.transaction((rows: DiscoveredVideo[]) => {
      for (const v of rows) {
        insertStmt.run({
          id: v.id,
          title: v.title,
          description: null,
          published_at: null,
          url: `https://www.youtube.com/watch?v=${v.id}`,
          thumbnail_url: `https://img.youtube.com/vi/${v.id}/hqdefault.jpg`,
          channel_name: channel.name,
          synced_at: new Date().toISOString(),
        });
      }
    });

    // Write every new video up front from discovery data (id, title, url,
    // thumbnail). This guarantees rows even if enrichment is rate-limited.
    if (newVideos.length > 0) {
      insertMany(newVideos);
      totalWritten += newVideos.length;
      for (const v of newVideos) existingIds.add(v.id);
    }

    // Best-effort enrichment pass: add description + published_at per video.
    // If the watch page is 429-blocked, the discovery row stays as-is. Abort
    // the pass after a run of consecutive failures so a hard IP rate-limit
    // doesn't make the cron job spin for minutes hitting 429s every time.
    let consecutiveFails = 0;
    for (let i = 0; i < newVideos.length; i++) {
      if (consecutiveFails >= MAX_ENRICH_FAILS_BEFORE_ABORT) {
        console.warn(
          `  enrichment aborted after ${consecutiveFails} consecutive failures ` +
            `(watch pages appear rate-limited); ${newVideos.length - i} videos kept with discovery metadata only.`,
        );
        totalEnrichFailed += newVideos.length - i;
        break;
      }
      const v = newVideos[i];
      const meta = await enrichVideo(v.id);
      if (!meta || (!meta.description && !meta.published_at && !meta.title)) {
        totalEnrichFailed++;
        consecutiveFails++;
        await sleep(ENRICH_DELAY_MS);
        continue;
      }
      consecutiveFails = 0;
      insertStmt.run({
        id: v.id,
        title: meta.title ?? v.title,
        description: meta.description,
        published_at: meta.published_at,
        url: `https://www.youtube.com/watch?v=${v.id}`,
        thumbnail_url: `https://img.youtube.com/vi/${v.id}/hqdefault.jpg`,
        channel_name: channel.name,
        synced_at: new Date().toISOString(),
      });
      totalEnriched++;
      console.log(
        `  [${i + 1}/${newVideos.length}] ${v.id} | ${meta.published_at?.slice(0, 10) ?? '????-??-??'} | ${(meta.title ?? v.title).slice(0, 55)}`,
      );
      await sleep(ENRICH_DELAY_MS);
    }

    const feedIds = await fetchFeedIds(channel.id);
    if (feedIds) {
      const notHeld = feedIds.filter((id) => !existingIds.has(id));
      if (notHeld.length > 0) problems.push(`${channel.name}: ${notHeld.length} video(s) in the channel feed are not held (${notHeld.slice(0, 3).join(', ')})`);
    }

    // This only ever inserted, so a video the channel removed or made private
    // stayed served with a link nobody can open. The uploads playlist is every
    // public video, so an id that left it is gone, private or unlisted.
    if (!complete) {
      problems.push(`${channel.name}: playlist walk did not finish, prune skipped`);
      continue;
    }
    const discovered = new Set(videos.map((v) => v.id));
    const candidates = (
      db.prepare('SELECT id FROM youtube_videos WHERE channel_name = ?').all(channel.name) as { id: string }[]
    ).map((r) => r.id).filter((id) => !discovered.has(id));
    const survivors: string[] = [];
    for (const id of candidates) {
      if (await stillWatchable(id)) {
        survivors.push(id);
        console.log(`  ${id} is not in the playlist but still resolves: unlisted, keeping`);
      }
      await sleep(DISCOVER_DELAY_MS);
    }
    const res = prune({
      table: 'youtube_videos',
      keyColumn: 'id',
      scopeColumn: 'channel_name',
      scopeValue: channel.name,
      liveKeys: [...discovered, ...survivors],
      // A row can carry a fetched transcript, so losing one costs more than a
      // re-crawlable page: keep the ratio guard in play from the second row.
      minDeleteAlways: 2,
    }, db);
    if (res.refused) {
      problems.push(`${channel.name}: ${res.reason}`);
      console.warn(`  prune REFUSED: ${res.reason}`);
    } else if (res.deleted) {
      console.log(`  pruned ${res.deleted} video(s) no longer in the uploads playlist`);
    }
  }

  const backfill = await backfillDescriptions(db);
  totalEnriched += backfill.enriched;
  if (backfill.left > 0) problems.push(`${backfill.left} held video(s) still without a description`);

  // FTS is kept in sync by AFTER INSERT/UPDATE/DELETE triggers, but rebuild
  // once at the end so a fresh run reconciles the contentless index exactly.
  try {
    db.prepare(`INSERT INTO youtube_videos_fts(youtube_videos_fts) VALUES('rebuild')`).run();
  } catch (err) {
    console.warn(`  FTS rebuild skipped: ${(err as Error).message}`);
  }

  console.log(
    `\nDone. Discovered: ${totalDiscovered}, written: ${totalWritten}, enriched: ${totalEnriched}, enrich failures: ${totalEnrichFailed}.`,
  );

  if (totalEnrichFailed > 0) problems.push(`${totalEnrichFailed} new video(s) kept with discovery metadata only`);

  if (problems.length) {
    logRun('youtube', { status: 'partial', items: totalWritten, error: problems.join(' ; ').slice(0, 1000) }, db);
  }
}

if (process.argv[2] === '--descriptions') {
  refreshDescriptions().catch((err) => {
    console.error('descriptions refresh failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
} else {
  guardSync('youtube', main).catch((err) => {
    console.error('YouTube sync failed:', err);
    process.exit(1);
  });
}
