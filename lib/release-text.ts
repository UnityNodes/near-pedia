import { marked } from 'marked';
import type { Token, Tokens } from 'marked';
import { htmlText } from './html-text';

const SUMMARY_MAX = 220;
const MEANINGFUL_CHARS = 40;
const LIST_ITEMS_IN_SUMMARY = 2;
const SUMMARY_HEADING = /^(?:summary|overview|highlights)$/i;
const POINTER = [
  /^see (?:the )?release(?: notes?)?\b/i,
  /^release notes?\b/i,
  /\bhas been released on\b/i,
  /^full changelog\b/i,
  /^release of\b/i,
  /^find the release notes\b/i,
  /^\.\.\s/,
];
const CONTRIBUTION = /\s+by\s+@\S+(?:\s+in\s+\S+)?\s*$/;
const MARKDOWN_LINK = /!?\[[^\]]*\]\([^)]*\)/g;

function inlineText(md: string): string {
  return htmlText(String(marked.parseInline(md)));
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

function isPointer(text: string): boolean {
  return POINTER.some(re => re.test(text));
}

function sentences(text: string): string {
  return text.split(/(?<=[.!?])\s+/).filter(s => !isPointer(s)).join(' ').trim();
}

function paragraphText(token: Token): string {
  if (token.type !== 'paragraph') return '';
  return sentences(inlineText((token as Tokens.Paragraph).text));
}

function listText(token: Token): string {
  if (token.type !== 'list') return '';
  const items = (token as Tokens.List).items
    .map(i => i.text.split(/\n\s*[-*+]\s/)[0].replace(/\s*\n\s*/g, ' '))
    .filter(raw => raw.replace(MARKDOWN_LINK, '').replace(/[|\s\-:]/g, '').length > 0)
    .map(raw => inlineText(raw).replace(CONTRIBUTION, '').trim())
    .filter(t => t.length > 0 && !isPointer(t) && /[a-z]{3}/i.test(t.replace(/https?:\/\/\S+/g, '')));
  return items.slice(0, LIST_ITEMS_IN_SUMMARY).join('; ');
}

function sectionTokens(tokens: Token[]): Token[] {
  const start = tokens.findIndex(t => t.type === 'heading' && SUMMARY_HEADING.test((t as Tokens.Heading).text.trim()));
  if (start < 0) return tokens;
  const depth = (tokens[start] as Tokens.Heading).depth;
  const end = tokens.findIndex((t, i) => i > start && t.type === 'heading' && (t as Tokens.Heading).depth <= depth);
  return tokens.slice(start + 1, end < 0 ? undefined : end);
}

export function releaseSummary(md: string | null | undefined, max = SUMMARY_MAX): string {
  if (!md?.trim()) return '';
  const tokens = sectionTokens(marked.lexer(md));
  for (const t of tokens) {
    const text = paragraphText(t);
    if (text.length >= MEANINGFUL_CHARS || (text && tokens.length === 1)) return clip(text, max);
  }
  for (const t of tokens) {
    const text = listText(t);
    if (text) return clip(text, max);
  }
  return '';
}

const TOP_HEADING = /<(\/?)h1\b/gi;
const LEADING_TITLE = /^\s*<h[1-6]\b[^>]*>\s*Release of [^<]*<\/h[1-6]>\s*/i;

export function notesHtml(html: string): string {
  return html.replace(LEADING_TITLE, '').replace(TOP_HEADING, (_, close: string) => `<${close}h2`);
}
