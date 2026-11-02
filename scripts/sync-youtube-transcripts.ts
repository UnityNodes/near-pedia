import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDb } from '../lib/db';
import { guardSync, logRun } from '../lib/sync-log';
import { encodeSegments, fitSegments, parsePanel, shrinksStored } from '../lib/video-transcript';
import type { FittedTranscript } from '../lib/video-transcript';

const DELAY_MS = 6000;
const RATE_LIMIT_COOLDOWN_MS = 90_000; // back off ~90s when YouTube returns 429
const MAX_TRANSCRIPT_CHARS = 200_000;
const ABORT_AFTER_LIMITED = 3;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Builds the protobuf `params` blob get_panel expects for a transcript panel.
// Layout: field21{ field1(videoId) field3=2 } - single-byte lengths are safe
// because YouTube video ids are always 11 chars.
function buildPanelParams(videoId: string): string {
  const id = Buffer.from(videoId, 'utf8');
  const inner = Buffer.concat([Buffer.from([0x0a, id.length]), id, Buffer.from([0x18, 0x02])]);
  const outer = Buffer.concat([Buffer.from([0xaa, 0x09, inner.length]), inner]);
  return outer.toString('base64');
}

type FetchResult =
  | { kind: 'ok'; transcript: FittedTranscript }
  | { kind: 'none' } // video has no transcript - mark attempted, never retry
  | { kind: 'error'; reason: string }; // transient - leave NULL, retry next run

// Pulls the transcript straight from YouTube's innertube `get_panel` endpoint.
// No yt-dlp, no cookies, no audio: fetch the watch page for a live
// INNERTUBE_CONTEXT (carries a valid visitorData), then ask for the transcript
// panel directly. Works from a cloud IP where yt-dlp's download path is blocked.
async function fetchTranscript(videoId: string): Promise<FetchResult> {
  let context: Record<string, unknown> & { client?: { clientVersion?: string } };
  try {
    const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (watchRes.status === 429) return { kind: 'error', reason: 'watch HTTP 429 (rate-limited)' };
    if (!watchRes.ok) return { kind: 'error', reason: `watch HTTP ${watchRes.status}` };
    const html = await watchRes.text();
    const m = html.match(/"INNERTUBE_CONTEXT":(\{[\s\S]+?\}),"INNERTUBE_CONTEXT_CLIENT_NAME"/);
    if (!m) return { kind: 'error', reason: 'no INNERTUBE_CONTEXT in watch page' };
    context = JSON.parse(m[1]);
  } catch (err) {
    return { kind: 'error', reason: `watch fetch: ${err instanceof Error ? err.message : String(err)}` };
  }

  const clientVersion = context.client?.clientVersion ?? '2.20260606.02.00';

  let json: unknown;
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/get_panel?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        'X-Youtube-Client-Name': '1',
        'X-Youtube-Client-Version': clientVersion,
        Origin: 'https://www.youtube.com',
        Referer: `https://www.youtube.com/watch?v=${videoId}`,
      },
      body: JSON.stringify({
        context,
        panelId: 'PAmodern_transcript_view',
        params: buildPanelParams(videoId),
      }),
    });
    if (!res.ok) return { kind: 'error', reason: `get_panel HTTP ${res.status}` };
    json = await res.json();
  } catch (err) {
    return { kind: 'error', reason: `get_panel fetch: ${err instanceof Error ? err.message : String(err)}` };
  }

  const segments = parsePanel(json);
  if (segments.length === 0) return { kind: 'none' };
  const transcript = fitSegments(segments, MAX_TRANSCRIPT_CHARS);
  if (transcript.text.length <= 50) return { kind: 'none' };
  return { kind: 'ok', transcript };
}

interface PendingVideo {
  id: string;
  title: string;
  has_text: number;
  old_text: string | null;
}


async function main(): Promise<number> {
  const db = getDb();

  // --force re-fetches everything; --retry re-attempts videos still missing a
  // transcript or its timings; --segments only adds timings to stored
  // transcripts; default picks only never-attempted videos.
  const force = process.argv.includes('--force');
  const retry = process.argv.includes('--retry');
  const segmentsOnly = process.argv.includes('--segments');

  const where = force
    ? '1=1'
    : segmentsOnly
      ? 'transcript_text IS NOT NULL AND transcript_segments IS NULL'
      : retry
        ? 'transcript_text IS NULL OR transcript_segments IS NULL'
        : 'transcript_text IS NULL AND transcript_synced_at IS NULL';

  const pending = db
    .prepare(`SELECT id, title, (transcript_text IS NOT NULL) AS has_text, transcript_text AS old_text FROM youtube_videos WHERE ${where} ORDER BY (channel_name = 'NEAR DevHub') DESC, published_at DESC`)
    .all() as PendingVideo[];

  console.log(`Found ${pending.length} videos to process.`);
  if (pending.length === 0) return 0;

  const storeStmt = db.prepare(
    `UPDATE youtube_videos SET transcript_text = ?, transcript_segments = ?, transcript_synced_at = ? WHERE id = ?`
  );
  const markStmt = db.prepare(
    `UPDATE youtube_videos SET transcript_synced_at = ? WHERE id = ?`
  );

  let stored = 0;
  let missing = 0;
  let errored = 0;
  let limited = 0;
  let aborted = false;

  for (let i = 0; i < pending.length; i++) {
    const v = pending[i];
    const label = `[${i + 1}/${pending.length}] ${v.title.slice(0, 55)}`;
    const result = await fetchTranscript(v.id);
    const syncedAt = new Date().toISOString();
    limited = result.kind === 'error' && result.reason.includes('429') ? limited + 1 : 0;
    if (limited >= ABORT_AFTER_LIMITED) {
      console.log(`  ${limited} requests in a row were rate-limited: stopping at ${i + 1}/${pending.length}; the next run continues.`);
      errored++;
      aborted = true;
      break;
    }

    if (result.kind === 'ok') {
      const { text, segments } = result.transcript;
      if (v.has_text && shrinksStored(v.old_text, text)) {
        errored++;
        console.log(`  ✗ ${label} - new text is ${text.length} characters against ${(v.old_text ?? '').length} stored: kept the stored one`);
      } else {
        storeStmt.run(text, encodeSegments(segments), syncedAt, v.id);
        stored++;
        console.log(`  ✓ ${label} - ${text.split(/\s+/).length} words, ${segments.length} segments`);
      }
    } else if (result.kind === 'none') {
      if (v.has_text) {
        errored++;
        console.log(`  ✗ ${label} - YouTube returned no transcript for a video that has one stored: kept the stored one`);
      } else {
        markStmt.run(syncedAt, v.id);
        missing++;
        console.log(`  - ${label} - no transcript`);
      }
    } else {
      errored++;
      console.log(`  ✗ ${label} - ${result.reason}`);
      if (result.reason.includes('429')) {
        console.log(`    cooling down ${Math.round(RATE_LIMIT_COOLDOWN_MS / 1000)}s before next attempt...`);
        await new Promise((r) => setTimeout(r, RATE_LIMIT_COOLDOWN_MS));
        continue;
      }
    }

    if (i < pending.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log(
    `\nDone. Stored: ${stored}, no transcript: ${missing}, errors (will retry): ${errored}`
  );

  if (aborted) {
    logRun('youtube-transcripts', { status: 'partial', items: stored, error: `stopped early after repeated rate limits; ${stored} stored, ${errored} not fetched` });
  } else if (errored > 0 && stored === 0 && missing === 0) {
    logRun('youtube-transcripts', { status: 'partial', items: 0, error: `all ${errored} transcript fetches failed` });
  } else {
    logRun('youtube-transcripts', { status: 'success', items: stored });
  }
  return stored;
}

guardSync('youtube-transcripts', main).catch((err) => {
  console.error('Transcripts sync failed:', err);
  process.exit(1);
});
