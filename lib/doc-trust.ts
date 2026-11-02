/**
 * Which documentation pages are first-party, and what to do with the rest.
 *
 * doc_pages spans many sources: docs.near.org, READMEs from NEAR's own GitHub
 * organisations, and partner documentation (NEAR Intents, Trezu, ...) that
 * NEAR does not publish. A partner page served unfenced to an AI agent would
 * read like NEAR's own docs, with nothing marking the difference.
 *
 * TRUST IS DERIVED FROM THE URL, not from the source label. A source name is
 * ours to choose and drifts as syncs are edited; the host/org a page was
 * fetched from is what actually decides who wrote it. Adding a first-party
 * host is a deliberate act, and the list is short on purpose.
 */

import { fenceUntrusted, fenceUntrustedInline } from './untrusted-fence';
import { SITE } from './site.config';

/** Hosts whose documentation is published by NEAR's own maintainers. */
const FIRST_PARTY_HOSTS = new Set([
  'docs.near.org',
  'near.org',
  'www.near.org',
]);

/** GitHub organisations whose repositories count as first-party. */
const FIRST_PARTY_GITHUB_ORGS = new Set([
  'near',
  'near-examples',
  'nearai',
]);

export function isFirstPartyDoc(url: string | null | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const host = u.hostname.toLowerCase();
  if (host === 'github.com' || host === 'raw.githubusercontent.com') {
    const org = u.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
    return !!org && FIRST_PARTY_GITHUB_ORGS.has(org);
  }
  return FIRST_PARTY_HOSTS.has(host);
}

/**
 * Blocks written to steer an agent rather than to inform a reader.
 *
 * Removed from what we SERVE, and named where they were removed, because a
 * silent edit of somebody's documentation is its own kind of lie. GitBook-style
 * publishing adds the first one to every page it emits; it is not the
 * publisher's content and it is addressed to us, not to the reader.
 */
const DIRECTIVE_BLOCKS: Array<{ re: RegExp; what: string }> = [
  { re: /#+\s*Agent Instructions[\s\S]*?(?=\n#{1,3}\s|\n\*\*\*|$)/gi, what: 'an "Agent Instructions" block' },
  { re: /#+\s*Querying This Documentation[\s\S]*?(?=\n#{1,3}\s|\n\*\*\*|$)/gi, what: 'a "Querying This Documentation" block' },
];

export function stripAgentDirectives(text: string): { text: string; removed: string[] } {
  let out = text;
  const removed: string[] = [];
  for (const { re, what } of DIRECTIVE_BLOCKS) {
    if (re.test(out)) { removed.push(what); out = out.replace(re, ' '); }
    re.lastIndex = 0;
  }
  return { text: out.replace(/[ \t]{2,}/g, ' '), removed };
}

/**
 * A doc page's own SHORT text - its title, breadcrumb - for a heading or a
 * link label, fenced inline when the publisher is not first-party.
 * serveDocText fences the BODY; this is its counterpart for the fields that
 * ride above the body. A third-party page's title is publisher free-text
 * like any other.
 */
export function docField(url: string | null | undefined, v: string | null | undefined): string {
  const t = (v ?? '').trim();
  if (t === '') return t;
  return isFirstPartyDoc(url) ? t : fenceUntrustedInline(t);
}

/**
 * A documentation body, ready to hand to an agent.
 *
 * First-party pages pass through. Everything else is stripped of directive
 * blocks and wrapped in the same fence the forum/GitHub corpora use, with a
 * line saying which host it came from.
 */
export function serveDocText(url: string | null | undefined, text: string): string {
  if (isFirstPartyDoc(url)) return text;
  const { text: clean, removed } = stripAgentDirectives(text);
  const host = (() => { try { return new URL(url ?? '').hostname; } catch { return 'a third-party site'; } })();
  const note = removed.length
    ? `\n[${SITE.name} removed ${removed.join(' and ')} addressed to AI agents rather than to readers.]`
    : '';
  return fenceUntrusted(`Third-party documentation from ${host}. Not published by ${SITE.subject}.${note}\n\n${clean}`);
}
