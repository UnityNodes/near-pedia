/**
 * find_code_examples: NEAR code on a topic, from the docs.near.org pages
 * and gov.near.org posts this index holds, each block run through
 * check_code before it is offered.
 *
 * The promise is examples on live APIs. A block that check_code finds
 * using something removed or deprecated is not hidden, since a reader may
 * be maintaining exactly that code, but it is listed after the live ones
 * with what in it is stale and what replaces it.
 */

import type Database from 'better-sqlite3';
import { checkCode, type Finding } from './check-code';
import type { Language } from './code-scan';
import { likeTokens, tokenize } from './rank';

export interface CodeExample {
  source: 'docs' | 'forum';
  title: string;
  url: string;
  language: Language;
  code: string;
  stale: Finding[];
}

const MIN_BLOCK = 40;
const MAX_BLOCK = 4000;
/** Blocks taken from one page: the examples should come from several places, not the first page's whole listing. */
const PER_PAGE = 2;

const FENCE_LANG: Record<string, Language> = {
  js: 'js', javascript: 'js', ts: 'js', typescript: 'js', jsx: 'js', tsx: 'js', mjs: 'js',
  rust: 'rust', rs: 'rust', toml: 'toml', json: 'json',
};

/**
 * A block as written, without the page's presentation: the "> " of a block
 * quoted in a callout, and Mintlify's diff markers (a line marked
 * `[!code --]` is the old line and is dropped; `[!code ++]`, `focus` and
 * `highlight` marks are removed from the line they annotate).
 */
export function cleanBlock(code: string): string {
  const lines = code.split('\n');
  const quoted = lines.filter((l) => l.trim()).every((l) => /^\s*>\s?/.test(l));
  return lines
    .map((l) => (quoted ? l.replace(/^\s*>\s?/, '') : l))
    .filter((l) => !/\[!code\s+--\]/.test(l))
    .map((l) => l.replace(/\s*(?:\/\/|#|\/\*|<!--)\s*\[!code\s+[^\]]*\]\s*(?:\*\/|-->)?\s*$/, ''))
    .join('\n')
    .trim();
}

/** ```lang … ``` blocks of a Markdown page, with the language the fence names. */
export function markdownBlocks(md: string): Array<{ language: Language; code: string }> {
  const out: Array<{ language: Language; code: string }> = [];
  for (const m of md.matchAll(/```([A-Za-z]+)[^\n]*\n([\s\S]*?)```/g)) {
    const language = FENCE_LANG[m[1].toLowerCase()];
    const code = cleanBlock(m[2]);
    if (language && code.length >= MIN_BLOCK && code.length <= MAX_BLOCK) out.push({ language: code.includes('[package]') || code.includes('[dependencies]') ? 'cargo' : language, code });
  }
  return out;
}

const decode = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** <pre><code class="lang-…"> blocks of a Discourse post, the language guessed from its class or its text. */
export function htmlBlocks(html: string): Array<{ language: Language; code: string }> {
  const out: Array<{ language: Language; code: string }> = [];
  for (const m of html.matchAll(/<pre[^>]*>\s*<code([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/g)) {
    const cls = m[1].match(/lang-(\w+)/)?.[1]?.toLowerCase();
    const code = cleanBlock(decode(m[2]));
    if (code.length < MIN_BLOCK || code.length > MAX_BLOCK) continue;
    const guessed: Language | undefined = (cls && FENCE_LANG[cls]) || (/\b(fn|impl|pub|use)\s/.test(code) && /;\s*$/m.test(code) ? 'rust' : /\b(import|const|await|function)\b/.test(code) ? 'js' : undefined);
    if (guessed) out.push({ language: guessed, code });
  }
  return out;
}

const STALE: ReadonlySet<Finding['severity']> = new Set(['error', 'warning']);
/** check_code runs synchronously on the server's one event loop: at most this many blocks a call. */
const MAX_CHECKED = 30;

/** Words of a topic that are code identifiers: snake_case, camelCase, or a path with :: or a dot. */
export function identifiersIn(topic: string): string[] {
  return [...new Set(topic.match(/[A-Za-z][A-Za-z0-9]*(?:(?:_|::|\.)[A-Za-z0-9]+)+|\b[a-z]+[A-Z][A-Za-z0-9]*\b/g) ?? [])];
}

export function findCodeExamples(db: Database.Database, topic: string, limit: number): { live: CodeExample[]; stale: CodeExample[] } {
  const terms = likeTokens(tokenize(topic)).slice(0, 4);
  if (!terms.length) return { live: [], stale: [] };
  // A topic that names an identifier (ft_transfer_call, viewFunction,
  // near_sdk::env) wants code that uses that identifier: half its words
  // matched nft_transfer. Otherwise a block has to carry half the topic's words.
  const idents = identifiersIn(topic);
  const need = Math.ceil(terms.length / 2);
  const relevant = (code: string) => idents.length
    ? idents.every((id) => new RegExp(`(?<![A-Za-z0-9_])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'i').test(code))
    : terms.filter((t) => code.toLowerCase().includes(t)).length >= need;
  const fts = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
  const candidates: Array<Omit<CodeExample, 'stale'>> = [];
  const pages = db.prepare(`SELECT d.title, d.url, d.content_text FROM doc_pages d JOIN docs_fts ON d.id = docs_fts.rowid
    WHERE docs_fts MATCH ? AND d.content_text LIKE '%\`\`\`%' ORDER BY rank LIMIT 12`).all(fts) as Array<{ title: string | null; url: string; content_text: string }>;
  for (const p of pages) {
    const hits = markdownBlocks(p.content_text).filter((b) => relevant(b.code));
    for (const b of hits.slice(0, PER_PAGE)) candidates.push({ source: 'docs', title: p.title ?? p.url, url: p.url, ...b });
  }
  try {
    const posts = db.prepare(`SELECT ft.title, ft.url, fp.cooked FROM forum_posts fp JOIN forum_topics ft ON ft.id = fp.topic_id
      WHERE fp.cooked LIKE '%<pre>%' AND (${terms.map(() => "(lower(fp.cooked) LIKE ? OR lower(ft.title) LIKE ?)").join(' OR ')}) ORDER BY fp.created_at DESC LIMIT 20`)
      .all(...terms.flatMap((t) => [`%${t}%`, `%${t}%`])) as Array<{ title: string; url: string; cooked: string }>;
    for (const p of posts) for (const b of htmlBlocks(p.cooked)) if (relevant(b.code)) candidates.push({ source: 'forum', title: p.title, url: p.url, ...b });
  } catch (e) {
    if (!/no such table/.test((e as Error).message)) throw e;
  }
  const seen = new Set<string>();
  const live: CodeExample[] = [];
  const stale: CodeExample[] = [];
  for (const c of candidates.slice(0, MAX_CHECKED)) {
    if (live.length + stale.length >= 2 * limit) break;
    const key = c.code.replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    const findings = checkCode(db, c.code, { language: c.language }).findings.filter((f) => STALE.has(f.severity));
    (findings.length ? stale : live).push({ ...c, stale: findings });
    if (live.length >= limit) break;
  }
  return { live: live.slice(0, limit), stale: stale.slice(0, Math.max(0, limit - live.length)) };
}

export function renderExamples(topic: string, r: { live: CodeExample[]; stale: CodeExample[] }, fence: (s: string) => string, fenceBlock: (s: string) => string): string {
  if (!r.live.length && !r.stale.length) return `No code block in the synced docs or forum matches "${fence(topic)}".`;
  const block = (e: CodeExample) => `${e.source === 'docs' ? 'docs.near.org' : 'gov.near.org'}: ${fence(e.title)}\n${e.url}\n${fenceBlock(`\`\`\`${e.language}\n${e.code}\n\`\`\``)}`;
  const parts = [`${r.live.length} example(s) on live APIs${r.stale.length ? `, ${r.stale.length} that check_code finds stale` : ''}, for "${fence(topic)}". Each was checked by check_code.`];
  for (const e of r.live) parts.push(block(e));
  for (const e of r.stale) parts.push(`STALE: ${fence(e.stale.map((f) => `${f.matched}: ${f.message}`).join('; '))}\n${block(e)}`);
  return parts.join('\n\n');
}
