/**
 * GitHub organisation repositories reduced to the fields the deprecation
 * engine reads, the "this is deprecated" notice a README opens with, and the
 * difference between two snapshots of a repository as change events.
 *
 * GitHub does not say WHEN a repository was archived. `archived_observed_at`
 * is the first sync that saw it archived; it is a true date only when an
 * earlier sync saw the same repository live, which the change event records.
 */

import type { ChangeEvent } from './change-events';

export interface RepoSnapshot {
  full_name: string;
  org: string;
  html_url: string;
  description: string | null;
  fork: boolean;
  archived: boolean;
  pushed_at: string | null;
  created_at: string | null;
  default_branch: string | null;
  stars: number | null;
  language: string | null;
  topics: string[];
  homepage: string | null;
}

interface GithubRepo {
  full_name?: string;
  html_url?: string;
  description?: string | null;
  fork?: boolean;
  archived?: boolean;
  pushed_at?: string | null;
  created_at?: string | null;
  default_branch?: string | null;
  stargazers_count?: number | null;
  language?: string | null;
  topics?: string[] | null;
  homepage?: string | null;
}

export function fromGithubRepo(r: GithubRepo): RepoSnapshot {
  if (!r.full_name || !r.html_url) throw new Error('GitHub repository without full_name/html_url');
  return {
    full_name: r.full_name,
    org: r.full_name.split('/')[0],
    html_url: r.html_url,
    description: r.description?.trim() || null,
    fork: Boolean(r.fork),
    archived: Boolean(r.archived),
    pushed_at: r.pushed_at ?? null,
    created_at: r.created_at ?? null,
    default_branch: r.default_branch ?? null,
    stars: r.stargazers_count ?? null,
    language: r.language ?? null,
    topics: Array.isArray(r.topics) ? r.topics : [],
    homepage: homepageUrl(r.homepage),
  };
}

/**
 * GitHub stores the homepage field as typed: near-examples had
 * `near-by-example-rust.vercel.app` with no scheme (2026-11-01), which no URL
 * parser accepts. A bare host gets https://; anything else unparseable is
 * dropped rather than stored as a link that does not open.
 */
export function homepageUrl(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(candidate);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href.replace(/\/$/, s.endsWith('/') ? '/' : '') : null;
  } catch {
    return null;
  }
}

export interface ReadmeNotice {
  strength: 'strong' | 'weak';
  /** The matched line and the two after it, for a reader. */
  notice: string;
  /**
   * The matched line alone. It is what identifies the notice from run to run:
   * keying on `notice` made an edit to the sentences after "# DEPRECATED"
   * read as a new deprecation.
   */
  marker: string;
  replacement: string | null;
}

/** A notice that sits this far down a README is part of the docs, not about the project. */
const WINDOW_LINES = 25;

/**
 * Each pattern names the repository itself as the thing deprecated. The
 * first version matched the bare words and, on the first live run over 804
 * NEAR repositories, 8 of 22 hits were about something else: a NEPs table row
 * marking one standard deprecated, list items in awesome-near and alertexer,
 * "DO NOT USE THIS REPOSITORY ISSUES DIRECTLY", "do not use Poetry to
 * install this", deprecated CLI flags in create-near-app.
 *
 * The subject must be the project, not any noun: "The old wallet API is
 * deprecated" is documentation about an API. A heading counts when it is the
 * README's first heading or shouts DEPRECATED; "## Deprecated flags" further
 * down is a section, not a notice.
 */
const PROJECT_NOUN = '(?:repo|repository|project|package|library|crate|sdk|tool|framework|indexer|cli|app|module|template|prototype|codebase|plugin|service|connector)';
const SUBJECT = String.raw`(?:this|the)\s+(?:[\w-]+\s+){0,2}${PROJECT_NOUN}\s+`;
const HEADING = /^#{1,6}\s/;
const STRONG = [
  /^\W*deprecat(?:ed|ion)\b(?!\s+(?:flags?|options?|methods?|apis?|features?|functions?)\b)/i,
  /\[deprecated\]/i,
  /^\W*do not use\W*$/i,
  /\bthis is an? (?:deprecated|archived|unmaintained)\b/i,
  new RegExp(String.raw`\b${SUBJECT}(?:is|has been|was)\s+(?:now\s+)?(?:deprecated|archived|sunset|discontinued|retired|unmaintained|not (?:actively )?maintained)\b`, 'i'),
  new RegExp(String.raw`\b${SUBJECT}(?:is|will)\s+no longer\s+(?:be\s+)?(?:maintained|supported|updated|receive any updates|in active development)\b`, 'i'),
];

/** A list item or a table row describes one entry, not the repository. */
const ENTRY_LINE = /^(?:[-*+]\s|\d+[.)]\s|\|)/;

const WEAK = [
  /\btransition period\b/i,
  /\bnew preferred\b/i,
  /\bsuperseded by\b/i,
  /\bmaintenance mode\b/i,
];

const POINTER = /\b(?:instead|migrate|replac|supersed|favou?r of|preferred|recommend|switch to|moved to|please (?:visit|see|use|refer)|refer to|consider using)/i;

function plainLines(markdown: string): string[] {
  return markdown
    .replace(/^(\s*)(```|~~~)[\s\S]*?^\1\2[^\n]*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map((l) => l.replace(/^\s*(?:>\s*)+/, '').trim())
    .filter((l) => l && !/^\[?!\[/.test(l) && !/^[-=*_]{3,}$/.test(l));
}

function firstLink(text: string): string | null {
  const md = text.match(/\[([^\]]+)\]\(([^)\s]+)\)/);
  if (md) {
    const label = md[1].replace(/[`*]/g, '').trim();
    return label === md[2] ? md[2] : `${label} (${md[2]})`;
  }
  const bare = text.match(/\[(https?:\/\/[^\]\s]+)\]/) ?? text.match(/(https?:\/\/[^\s)\]]+)/);
  if (bare) return bare[1];
  const code = text.match(/`([^`]+)`/);
  return code ? code[1] : null;
}

/**
 * The deprecation notice a README opens with, or null. Only the top of the
 * file is read: "`foo()` is deprecated, use `bar()`" further down is API
 * documentation, and reading it as a notice about the repository would mark
 * half of NEAR's live SDKs deprecated.
 */
export function detectReadmeNotice(markdown: string): ReadmeNotice | null {
  const lines = plainLines(markdown).slice(0, WINDOW_LINES);
  const firstHeading = lines.findIndex((l) => HEADING.test(l));
  const headingNotice = (l: string, i: number) =>
    HEADING.test(l) && (/\bDEPRECATED\b/.test(l) || (i === firstHeading && /\bdeprecated\b/i.test(l)));
  const about = (l: string, patterns: RegExp[]) => !ENTRY_LINE.test(l) && patterns.some((re) => re.test(l));
  const strong = lines.findIndex((l, i) => headingNotice(l, i) || about(l, STRONG));
  const weak = strong === -1 ? lines.findIndex((l) => about(l, WEAK)) : -1;
  const at = strong !== -1 ? strong : weak;
  if (at === -1) return null;

  const clean = (s: string) => s.replace(/[#*]/g, '').replace(/\s+/g, ' ').trim();
  const notice = clean(lines.slice(at, at + 3).join(' ')).slice(0, 240);
  const marker = clean(lines[at]).slice(0, 240);
  const around = lines.slice(at, at + 8);
  const pointerLine = around.find((l) => POINTER.test(l) && firstLink(l));
  return {
    strength: strong !== -1 ? 'strong' : 'weak',
    notice,
    marker,
    replacement: pointerLine ? firstLink(pointerLine) : null,
  };
}

export interface StoredRepo {
  full_name: string;
  archived: number;
  readme_marker: string | null;
}

export function diffRepo(before: StoredRepo | undefined, after: RepoSnapshot): ChangeEvent[] {
  if (!before) return [];
  if (!before.archived && after.archived) {
    return [{ kind: 'repo_archived', subject: `github:${after.full_name}`, title: `${after.full_name} was archived`, detail: { pushed_at: after.pushed_at, seen_live_before: true }, source_url: after.html_url, key: after.pushed_at ?? 'archived' }];
  }
  if (before.archived && !after.archived) {
    return [{ kind: 'repo_unarchived', subject: `github:${after.full_name}`, title: `${after.full_name} was unarchived`, source_url: after.html_url, key: after.pushed_at ?? 'unarchived' }];
  }
  return [];
}

/**
 * A README notice is news only when an earlier check saw the README without
 * it; the first check of a repository records its state, not an event.
 */
export function readmeNoticeEvent(
  full_name: string,
  html_url: string,
  checkedBefore: boolean,
  previous: string | null,
  current: ReadmeNotice | null,
): ChangeEvent[] {
  if (!checkedBefore || !current || previous === current.marker) return [];
  return [{
    kind: 'repo_readme_notice',
    subject: `github:${full_name}`,
    title: `${full_name} README: ${current.notice.slice(0, 120)}`,
    detail: { strength: current.strength, notice: current.notice, replacement: current.replacement },
    source_url: html_url,
    key: current.marker,
  }];
}
