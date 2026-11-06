/**
 * Video metadata from YouTube's innertube `next` endpoint, the call the
 * watch page itself makes for its title, date and description.
 *
 * On 2026-11-02 the watch page answered this server with a 302 and the
 * `player` endpoint with LOGIN_REQUIRED for every client, so every video kept
 * only its title. `next` still answered: it carries the description, which is
 * what makes a video worth a place in the meaning index. sync-youtube asks it
 * when the watch page refuses.
 */

export interface NextMetadata {
  title: string | null;
  description: string | null;
  published_at: string | null;
}

export const NEXT_URL = 'https://www.youtube.com/youtubei/v1/next?prettyPrint=false';

export function nextRequestBody(videoId: string, clientVersion: string): string {
  return JSON.stringify({ videoId, context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US' } } });
}

type Json = Record<string, unknown>;

function results(body: Json): Json[] {
  const r = (body.contents as Json | undefined)?.twoColumnWatchNextResults as Json | undefined;
  const contents = ((r?.results as Json | undefined)?.results as Json | undefined)?.contents;
  return Array.isArray(contents) ? (contents as Json[]) : [];
}

/** "Apr 24, 2024", "Premiered Apr 24, 2024", "Streamed live on Apr 24, 2024": the date, or null. */
export const NOT_YET_PUBLISHED = /^\s*(Scheduled for|Premieres)\b/i;

export function parseDateText(text: string | null | undefined): string | null {
  if (!text || NOT_YET_PUBLISHED.test(text)) return null;
  const m = /([A-Z][a-z]{2} \d{1,2}, \d{4})/.exec(text);
  if (!m) return null;
  const d = new Date(`${m[1]} 00:00:00 UTC`);
  return Number.isNaN(d.getTime()) || d.getTime() > Date.now() ? null : d.toISOString();
}

export function parseNext(body: Json): NextMetadata {
  const items = results(body);
  const primary = items.find((c) => c.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer as Json | undefined;
  const secondary = items.find((c) => c.videoSecondaryInfoRenderer)?.videoSecondaryInfoRenderer as Json | undefined;
  const runs = (primary?.title as Json | undefined)?.runs;
  const title = Array.isArray(runs) ? (runs as Json[]).map((r) => String(r.text ?? '')).join('').trim() || null : null;
  const description = String((secondary?.attributedDescription as Json | undefined)?.content ?? '').trim() || null;
  const published_at = parseDateText((primary?.dateText as Json | undefined)?.simpleText as string | undefined);
  return { title, description, published_at };
}
