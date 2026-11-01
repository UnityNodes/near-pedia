import { capText, TRUNCATION_MARKER } from './cap-text';

export interface TranscriptSegment {
  start: number;
  text: string;
}

export interface TranscriptBlock {
  start: number;
  text: string;
}

export interface TranscriptPassage {
  start: number;
  text: string;
}

const NOISE_TAG = /\[(?:music|applause|laughter|silence|inaudible|cheering|noise|foreign)\]/gi;
const BARE_FOREIGN = /^foreign$/i;
const BLOCK_CHARS = 380;
const BLOCK_MAX_SECONDS = 60;
const SENTENCE_END = /[.!?]["')\]]?$/;

export function parseClock(label: string | null | undefined): number | null {
  if (!label) return null;
  const parts = label.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  let seconds = 0;
  for (const part of parts) {
    if (!/^\d{1,2}$/.test(part)) return null;
    seconds = seconds * 60 + parseInt(part, 10);
  }
  return seconds;
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

export function cleanSegmentText(raw: string): string {
  const text = raw.replace(NOISE_TAG, ' ').replace(/\s+/g, ' ').trim();
  return BARE_FOREIGN.test(text) ? '' : text;
}

interface PanelSegment {
  simpleText?: unknown;
  timestamp?: unknown;
}

export function parsePanel(json: unknown): TranscriptSegment[] {
  const found: PanelSegment[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const seg = record.transcriptSegmentViewModel;
    if (seg && typeof seg === 'object') found.push(seg as PanelSegment);
    for (const key of Object.keys(record)) walk(record[key]);
  };
  walk(json);

  const out: TranscriptSegment[] = [];
  let lastStart = 0;
  for (const seg of found) {
    if (typeof seg.simpleText !== 'string') continue;
    const clock = typeof seg.timestamp === 'string' ? parseClock(seg.timestamp) : null;
    const start = clock ?? lastStart;
    lastStart = start;
    const text = cleanSegmentText(seg.simpleText);
    if (text) out.push({ start, text });
  }
  return out;
}

export function segmentsText(segments: readonly TranscriptSegment[]): string {
  return segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
}

export interface FittedTranscript {
  text: string;
  segments: TranscriptSegment[];
  truncated: boolean;
}

export function fitSegments(segments: readonly TranscriptSegment[], max: number): FittedTranscript {
  const full = segmentsText(segments);
  if (full.length <= max) return { text: full, segments: [...segments], truncated: false };
  const text = capText(full, max);
  const cut = text.length - TRUNCATION_MARKER.length - 2;
  const kept: TranscriptSegment[] = [];
  let offset = 0;
  for (const seg of segments) {
    const end = offset + seg.text.length;
    if (end > cut) break;
    kept.push(seg);
    offset = end + 1;
  }
  return { text, segments: kept, truncated: true };
}

export function encodeSegments(segments: readonly TranscriptSegment[]): string {
  return JSON.stringify(segments.map(s => [s.start, s.text]));
}

export function decodeSegments(json: string | null | undefined): TranscriptSegment[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: TranscriptSegment[] = [];
  for (const item of parsed) {
    if (!Array.isArray(item) || typeof item[0] !== 'number' || typeof item[1] !== 'string') return [];
    out.push({ start: item[0], text: item[1] });
  }
  return out;
}

export function groupSegments(segments: readonly TranscriptSegment[], maxChars: number = BLOCK_CHARS): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  let current: { start: number; parts: string[]; length: number } | null = null;
  const close = () => {
    if (current) blocks.push({ start: current.start, text: current.parts.join(' ') });
    current = null;
  };
  for (const seg of segments) {
    if (current && (seg.start - current.start > BLOCK_MAX_SECONDS || current.length >= maxChars)) close();
    if (!current) current = { start: seg.start, parts: [], length: 0 };
    current.parts.push(seg.text);
    current.length += seg.text.length + 1;
    if (current.length >= maxChars * 0.6 && SENTENCE_END.test(seg.text)) close();
  }
  close();
  return blocks;
}

export function timeLink(videoId: string, start: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(start)}s`;
}

export function renderTimed(blocks: readonly TranscriptBlock[]): string {
  return blocks.map(b => `[${formatClock(b.start)}] ${b.text}`).join('\n');
}

const MAX_QUERY_TOKENS = 12;
const MAX_QUERY_CHARS = 200;

export function queryTokens(query: string): string[] {
  const seen = new Set<string>();
  for (const raw of query.slice(0, MAX_QUERY_CHARS).toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length >= 2) seen.add(raw);
    if (seen.size >= MAX_QUERY_TOKENS) break;
  }
  return [...seen];
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function tokenMatcher(token: string): RegExp {
  const stem = token.length >= 4 && token.endsWith('s') ? token.slice(0, -1) : null;
  const alternatives = [token, ...(stem ? [stem] : [])].map(escapeForRegExp).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})`, 'u');
}

const SCORE_WINDOW = 2;
const CONTEXT_BEFORE = 1;
const CONTEXT_AFTER = 1;
const SEPARATION = SCORE_WINDOW + CONTEXT_BEFORE + CONTEXT_AFTER;
const FIRST_SEGMENT_BONUS = 0.001;

export function findPassages(segments: readonly TranscriptSegment[], query: string, limit: number = 3): TranscriptPassage[] {
  const tokens = queryTokens(query);
  const phrase = query.slice(0, MAX_QUERY_CHARS).trim().toLowerCase();
  if (segments.length === 0 || (tokens.length === 0 && !phrase)) return [];

  const matchers = tokens.map(tokenMatcher);
  const phraseMatcher = phrase.length >= 2 && tokens.length > 1 ? tokenMatcher(phrase) : null;
  const lowered = segments.map(s => s.text.toLowerCase());
  const inSegment = lowered.map(text => matchers.map(m => m.test(text)));
  const docFreq = matchers.map((_, i) => inSegment.filter(row => row[i]).length);
  const weights = docFreq.map(df => Math.log(1 + segments.length / Math.max(1, df)));

  const scored: { index: number; score: number }[] = [];
  for (let i = 0; i < segments.length; i++) {
    let score = 0;
    for (let t = 0; t < matchers.length; t++) {
      if (inSegment[i][t] || (i + 1 < segments.length && inSegment[i + 1][t])) score += weights[t];
    }
    if (score === 0) continue;
    if (phraseMatcher && phraseMatcher.test(lowered.slice(i, i + SCORE_WINDOW).join(' '))) score += 2 * tokens.length + 1;
    if (inSegment[i].some(Boolean)) score += FIRST_SEGMENT_BONUS;
    scored.push({ index: i, score });
  }
  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const taken: number[] = [];
  const out: TranscriptPassage[] = [];
  for (const candidate of scored) {
    if (taken.some(t => Math.abs(t - candidate.index) < SEPARATION)) continue;
    taken.push(candidate.index);
    const from = Math.max(0, candidate.index - CONTEXT_BEFORE);
    const slice = segments.slice(from, candidate.index + SCORE_WINDOW + CONTEXT_AFTER);
    out.push({ start: slice[0].start, text: segmentsText(slice) });
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => a.start - b.start);
}

export function plainParagraphs(text: string, maxChars: number = 700): string[] {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+["')\]]?\s*|[^.!?]+$/g) ?? [];
  const pieces: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      pieces.push(sentence);
      continue;
    }
    let run = '';
    for (const word of sentence.split(' ')) {
      if (run && run.length + word.length + 1 > maxChars) {
        pieces.push(`${run} `);
        run = '';
      }
      run += run ? ` ${word}` : word;
    }
    if (run) pieces.push(run);
  }
  const out: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length > maxChars) {
      out.push(current.trim());
      current = '';
    }
    current += piece;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export function excerptAround(text: string, tokens: readonly string[], width: number = 190): string {
  if (text.length <= width) return text;
  const lower = text.toLowerCase();
  let at = -1;
  for (const token of tokens) {
    const i = lower.search(tokenMatcher(token));
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) at = 0;
  let end = Math.min(text.length, Math.max(0, at - Math.floor(width * 0.3)) + width);
  let start = Math.max(0, end - width);
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space >= 0 && space < at) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > at) end = space;
  }
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

export const MIN_KEPT_RATIO = 0.5;

export function shrinksStored(storedText: string | null | undefined, nextText: string): boolean {
  const previous = storedText ? cleanSegmentText(storedText).length : 0;
  return previous > 0 && nextText.length < previous * MIN_KEPT_RATIO;
}
