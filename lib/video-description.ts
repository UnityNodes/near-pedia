interface CommandRun {
  startIndex?: number;
  length?: number;
  onTap?: { innertubeCommand?: { urlEndpoint?: { url?: unknown } } };
}

interface AttributedDescription {
  content?: unknown;
  commandRuns?: CommandRun[];
}

export function extractJsonObject(source: string, from: number): string | null {
  let open = from;
  while (open < source.length && /\s/.test(source[open])) open++;
  if (source[open] !== '{') return null;
  let depth = 0;
  let inString = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

function targetOf(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (/(^|\.)youtube\.com$/.test(parsed.hostname)) {
    if (parsed.pathname !== '/redirect') return null;
    const target = parsed.searchParams.get('q');
    return target && /^https?:\/\//i.test(target) ? target : null;
  }
  return /^https?:\/\//i.test(url) ? url : null;
}

const LINK_DISPLAY = /^(?:https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,}(?:\/|$))/i;

export function resolveDescription(attributed: AttributedDescription): string | null {
  if (typeof attributed.content !== 'string' || !attributed.content) return null;
  const runs = (attributed.commandRuns ?? [])
    .filter((r): r is CommandRun & { startIndex: number; length: number } => typeof r.startIndex === 'number' && typeof r.length === 'number')
    .sort((a, b) => b.startIndex - a.startIndex);
  let text = attributed.content;
  for (const run of runs) {
    const target = targetOf(run.onTap?.innertubeCommand?.urlEndpoint?.url);
    if (!target || !LINK_DISPLAY.test(text.slice(run.startIndex, run.startIndex + run.length))) continue;
    text = text.slice(0, run.startIndex) + target + text.slice(run.startIndex + run.length);
  }
  return text;
}

export function descriptionFromWatchPage(html: string): string | null {
  for (const key of html.matchAll(/"attributedDescription(?:BodyText)?":/g)) {
    const raw = extractJsonObject(html, (key.index ?? 0) + key[0].length);
    if (!raw) continue;
    try {
      const resolved = resolveDescription(JSON.parse(raw) as AttributedDescription);
      if (resolved) return resolved;
    } catch {
      continue;
    }
  }
  return null;
}

export type DescriptionPart = { kind: 'text'; text: string } | { kind: 'link'; href: string; label: string };

const URL_PATTERN = /https?:\/\/[^\s<>"]+/g;
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', "'", '"']);
const FORMAT_CHARS = /\p{Cf}/gu;

function count(text: string, ch: string): number {
  let n = 0;
  for (const c of text) if (c === ch) n++;
  return n;
}

function trimTrailingPunctuation(url: string): string {
  let end = url.length;
  while (end > 0 && TRAILING_PUNCTUATION.has(url[end - 1])) {
    const last = url[end - 1];
    const body = url.slice(0, end);
    const opener = last === ')' ? '(' : last === ']' ? '[' : last === '}' ? '{' : null;
    if (opener && count(body, opener) >= count(body, last)) break;
    end--;
  }
  return url.slice(0, end);
}

export function descriptionParts(paragraph: string): DescriptionPart[] {
  const parts: DescriptionPart[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && last.kind === 'text') last.text += text;
    else parts.push({ kind: 'text', text });
  };
  let cursor = 0;
  for (const match of paragraph.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    const raw = match[0];
    const trimmed = trimTrailingPunctuation(raw);
    pushText(paragraph.slice(cursor, index));
    if (/(\.\.\.|…)$/.test(raw) || !/^https?:\/\/[^\s/]/i.test(trimmed)) {
      pushText(raw);
    } else {
      parts.push({ kind: 'link', href: trimmed, label: trimmed.replace(FORMAT_CHARS, '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') });
      pushText(raw.slice(trimmed.length));
    }
    cursor = index + raw.length;
  }
  pushText(paragraph.slice(cursor));
  return parts;
}

export function descriptionParagraphs(description: string | null | undefined): string[] {
  return (description ?? '').split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
}
