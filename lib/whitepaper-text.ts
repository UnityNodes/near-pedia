export type ReaderBlock =
  | { kind: 'page'; n: number }
  | { kind: 'heading'; text: string; id: string; level: 2 | 3 }
  | { kind: 'p'; text: string; keepLines?: true };

export interface ReaderText {
  blocks: ReaderBlock[];
  removed: { runningHeaders: string[]; pageNumbers: number; lines: string[] };
}

const INVISIBLE = /[​‌‍⁠﻿­]/g;
const PAGE_NUMBER = /^(?:page\s+)?\d{1,4}(?:\s*(?:\/|of)\s*\d{1,4})?$/i;
const EDGE_LINES = 2;
const RUNNING_SHARE = 0.3;
const RUNNING_MIN_PAGES = 3;
const HEADING_MAX_CHARS = 70;
const HEADING_MAX_WORDS = 9;
const MARKED_MAX_CHARS = 160;
const MARKED_MAX_WORDS = 24;
const PART_MAX_CHARS = 300;
const PART_MAX_WORDS = 48;
const PART_MAX_LINES = 3;
const PROSE_LINE_CHARS = 40;
const CONTENTS_SHARE = 0.5;
const CONTENTS_PAGE_MIN_LINES = 5;
const CONTENTS_GROUP_MIN_LINES = 3;
const PART_MARK = /^Part\s+[A-Z0-9]{1,3}\s*[-–—:]\s*\S/;
const SECTION_MARK = /^(?:\d+(?:\.\d+)+\.?|\d+|[A-Z]\.|[IVXLC]+\.)\s+\S/;
const BARE_MARK = /^(?:[A-Z]|[IVXLC]+)\.$/;
const MID_GROUP_HEADING = /^\d+(?:\.\d+)*\s+[A-Z]/;
const LIST_ITEM = /^\d+[.)]\s/;
const CAPTION = /^(?:(?:figure|fig\.|table)\s*\d|\([a-z]\)\s)/i;
const ENDS_A_SENTENCE = /[.!?]["”’)]?$/;
const HAS_A_SENTENCE_END = /[.!?]["”’)]?(?:\s|$)/;
const ENDS_IN_PUNCTUATION = /(?:[.,;:!?]["”’)\]]*|[)\]])$/;
const ENDS_MID_PHRASE = /\b(?:and|or|of|the|to|for|in|on|with|from|a|an|by|at|as|its|their)$/i;
const TRAILING_PAGE_NUMBER = /\s(\d{1,3})$/;
const SUBSECTION = /^\d+\.\d+/;
const NOT_A_HEADING = [
  /^(?:figure|fig\.|table)\s*\d/i,
  /^source:/i,
  /^\d+(?:\.\d+)*\.?\s+[a-z]/,
  /^[A-Z]{1,2}\.\d+(?:\.\d+)?\s/,
  /^0\d\s/,
  /\s\d{1,3}$/,
  /[=_{};<>]/,
  /\b[A-Za-z]+\d+\b/,
  /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?:\d{1,2},?\s+)?\d{4}$/i,
  /^\d{4}-\d{2}-\d{2}$/,
];
const STARTS_A_SENTENCE = /^(?:[A-Z“"(•\-–]|\d+[.)]?\s+[A-Z])/;

type Item = { kind: 'page'; n: number } | { kind: 'group'; lines: string[]; page: number; headings: boolean };

function clean(line: string): string {
  return line.replace(INVISIBLE, '').replace(/[ \t ]+/g, ' ').trim();
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
}

export function isHeadingLine(line: string): boolean {
  const part = PART_MARK.test(line), marked = part || SECTION_MARK.test(line);
  const [maxChars, maxWords] = part ? [PART_MAX_CHARS, PART_MAX_WORDS] : marked ? [MARKED_MAX_CHARS, MARKED_MAX_WORDS] : [HEADING_MAX_CHARS, HEADING_MAX_WORDS];
  if (line.length === 0 || line.length > maxChars) return false;
  if (!/[A-Za-z]/.test(line) || PAGE_NUMBER.test(line)) return false;
  if (ENDS_IN_PUNCTUATION.test(line)) return false;
  if (!/^[A-Z0-9]/.test(line)) return false;
  if (/[$%€£]/.test(line)) return false;
  if (NOT_A_HEADING.some(re => re.test(line))) return false;
  return line.split(/\s+/).length <= maxWords;
}

function isProse(lines: string[]): boolean {
  if (lines.length === 0 || CAPTION.test(lines[0])) return false;
  return lines.some(l => l.length >= PROSE_LINE_CHARS) && lines.some(l => HAS_A_SENTENCE_END.test(l));
}

function looksLikeContents(lines: string[], minLines: number): boolean {
  const filled = lines.filter(Boolean);
  if (filled.length < minLines) return false;
  const numbers = filled.flatMap(l => {
    const m = TRAILING_PAGE_NUMBER.exec(l);
    return m ? [Number(m[1])] : [];
  });
  return numbers.length / filled.length >= CONTENTS_SHARE && numbers.every((n, i) => i === 0 || n >= numbers[i - 1]);
}

function splitAtSections(group: string[]): string[][] {
  const parts: string[][] = [[]];
  group.forEach((line, i) => {
    const prev = group[i - 1], next = group[i + 1];
    const startsSection = i > 0 && prev !== undefined && next !== undefined
      && ENDS_A_SENTENCE.test(prev) && MID_GROUP_HEADING.test(line) && isHeadingLine(line) && /^[A-Z“"(]/.test(next);
    if (startsSection) parts.push([]);
    parts[parts.length - 1].push(line);
  });
  return parts.filter(p => p.length > 0);
}

function wrappedTitle(lines: string[]): string | null {
  const [first, ...rest] = lines;
  const part = PART_MARK.test(first);
  if (rest.length === 0 || rest.length > (part ? PART_MAX_LINES - 1 : 1)) return null;
  if (!part && !SECTION_MARK.test(first)) return null;
  if (rest.some(l => PART_MARK.test(l) || SECTION_MARK.test(l))) return null;
  const continues = rest.every((l, i) => /^[a-z]/.test(l) || ENDS_MID_PHRASE.test(lines[i]));
  if (!continues || lines.slice(0, -1).some(l => ENDS_A_SENTENCE.test(l))) return null;
  const joined = lines.join(' ');
  return isHeadingLine(joined) ? joined : null;
}

function headingOf(lines: string[]): { title: string; body: string[] } | null {
  const [first, ...rest] = lines;
  if (BARE_MARK.test(first) && rest.length > 0) {
    const title = `${first} ${rest[0]}`;
    return isHeadingLine(title) ? { title, body: rest.slice(1) } : null;
  }
  if (!isHeadingLine(first)) return null;
  const wrapped = wrappedTitle(lines);
  return wrapped ? { title: wrapped, body: [] } : { title: first, body: rest };
}

function captionBeforeProse(items: Item[], from: number, page: number): boolean {
  for (let j = from; j < items.length; j++) {
    const it = items[j];
    if (it.kind === 'page' || it.page !== page) return false;
    if (CAPTION.test(it.lines[0])) return true;
    if (isProse(it.lines)) return false;
  }
  return false;
}

function isFigureLabel(items: Item[], index: number, page: number, body: string[]): boolean {
  if (body.length === 0) {
    const next = items[index + 1];
    return next?.kind === 'group' && next.page === page && CAPTION.test(next.lines[0]);
  }
  return !isProse(body) && captionBeforeProse(items, index + 1, page);
}

function edgeIndexes(lines: string[]): number[] {
  const filled = lines.map((l, i) => (l ? i : -1)).filter(i => i >= 0);
  return [...new Set([...filled.slice(0, EDGE_LINES), ...filled.slice(-EDGE_LINES)])];
}

function lastFilled(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i]) return i;
  return -1;
}

function firstFilled(lines: string[]): number {
  return lines.findIndex(Boolean);
}

function runningHeaders(pages: string[][]): Set<string> {
  const edgeCounts = new Map<string, number>();
  for (const lines of pages) {
    for (const l of new Set(edgeIndexes(lines).map(i => lines[i]))) {
      if (!PAGE_NUMBER.test(l)) edgeCounts.set(l, (edgeCounts.get(l) ?? 0) + 1);
    }
  }
  const threshold = Math.max(RUNNING_MIN_PAGES, Math.ceil(pages.length * RUNNING_SHARE));
  return new Set([...edgeCounts].filter(([, n]) => n >= threshold).map(([l]) => l));
}

function stripPage(original: string[], running: Set<string>, removed: ReaderText['removed']): string[] {
  const lines = [...original];
  for (const i of edgeIndexes(lines)) if (running.has(lines[i])) { removed.lines.push(lines[i]); lines[i] = ''; }
  for (const i of new Set([firstFilled(lines), lastFilled(lines)])) {
    if (i >= 0 && PAGE_NUMBER.test(lines[i])) { removed.lines.push(lines[i]); lines[i] = ''; removed.pageNumbers++; }
  }
  return lines;
}

function groupsOf(lines: string[]): string[][] {
  const groups: string[][] = [];
  let group: string[] = [];
  for (const line of [...lines, '']) {
    if (line) group.push(line);
    else if (group.length) { groups.push(...splitAtSections(group)); group = []; }
  }
  return groups;
}

function headingIds(): (title: string) => string {
  const ids = new Map<string, number>();
  return title => {
    const base = slug(title);
    const n = (ids.get(base) ?? 0) + 1;
    ids.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

function blocksOf(items: Item[]): ReaderBlock[] {
  const blocks: ReaderBlock[] = [];
  const idOf = headingIds();
  items.forEach((it, index) => {
    if (it.kind === 'page') { blocks.push(it); return; }
    const { lines, page } = it;
    if (!it.headings || looksLikeContents(lines, CONTENTS_GROUP_MIN_LINES)) {
      blocks.push({ kind: 'p', text: lines.join('\n'), keepLines: true });
      return;
    }
    const heading = headingOf(lines);
    const isList = LIST_ITEM.test(lines[0]) && lines.length > 1 && LIST_ITEM.test(lines[1]);
    const leadsProse = heading !== null && (heading.body.length === 0 || STARTS_A_SENTENCE.test(heading.body[0]));
    if (!heading || isList || !leadsProse || isFigureLabel(items, index, page, heading.body)) {
      blocks.push({ kind: 'p', text: lines.join(' ') });
      return;
    }
    blocks.push({ kind: 'heading', text: heading.title, id: idOf(heading.title), level: SUBSECTION.test(heading.title) ? 3 : 2 });
    if (heading.body.length) blocks.push({ kind: 'p', text: heading.body.join(' ') });
  });
  return blocks;
}

export function readerText(text: string | null | undefined): ReaderText {
  const removed: ReaderText['removed'] = { runningHeaders: [], pageNumbers: 0, lines: [] };
  if (!text) return { blocks: [], removed };

  const pages = text.split('\f').map(p => p.split('\n').map(clean));
  const running = runningHeaders(pages);
  removed.runningHeaders = [...running];

  const items: Item[] = [];
  pages.forEach((original, pageIndex) => {
    const lines = stripPage(original, running, removed);
    if (pageIndex > 0 && lines.some(Boolean)) items.push({ kind: 'page', n: pageIndex + 1 });
    const headings = !looksLikeContents(lines, CONTENTS_PAGE_MIN_LINES);
    for (const group of groupsOf(lines)) items.push({ kind: 'group', lines: group, page: pageIndex, headings });
  });

  return { blocks: blocksOf(items), removed };
}

export interface ContentsItem {
  id: string;
  text: string;
  level: 2 | 3;
}

function sameText(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return norm(a) === norm(b);
}

export function contentsOf(blocks: ReaderBlock[], title: string): ContentsItem[] {
  return blocks.flatMap(b => (b.kind === 'heading' && !sameText(b.text, title) ? [{ id: b.id, text: b.text, level: b.level }] : []));
}

export function wordsOf(s: string): string[] {
  return s.replace(INVISIBLE, '').toLowerCase().match(/[\p{L}\p{N}$%€£]+/gu) ?? [];
}
