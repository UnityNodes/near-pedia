/**
 * Pure extractors for two of the engine's signals: removals and
 * deprecations announced in release notes, and the `[Deprecated]` marker the
 * docs.near.org RPC reference carries.
 */

export interface ReleaseRemoval {
  action: 'removed' | 'deprecated';
  /** The identifiers the sentence removes or deprecates: the backticked span right after the verb. */
  removed: string[];
  /** Every backticked identifier in the line, for matching against curated entries. */
  mentioned: string[];
  line: string;
}

/**
 * Sections whose bullets are fixes and internal work. "remove stale entries
 * for a partially consumed `Drain`" under near-sdk-rs's Fixed is a bug fix,
 * not a removal anyone's code depends on.
 */
const SKIP_SECTION = /\b(?:fix|fixes|fixed|bug|refactor|chore|misc|miscellaneous|internal|test|tests|testing|ci|docs?|documentation|build|perf|performance|dependencies|note|migration|migrating|upgrade|upgrading|instructions)\b/i;

/**
 * Words that make a removal internal housekeeping ("Remove a redundant
 * `assert` call", near-api-js 6.5.1) or a change to tooling output ("remove
 * `double_contract_state_error` diagnostic", near-sdk 5.8.1) rather than
 * something a caller's code depends on.
 */
const HOUSEKEEPING = /\b(?:redundant|unused|unnecessary|duplicated?|dead|leftover)\b/i;
const NOT_AN_INTERFACE = /^\s*(?:diagnostics?|lints?|warnings?|logs?|logging|tests?|examples?|comments?|assertions?|limits?|dependency|dependencies|requirements?|checks?|restrictions?|bounds?|constraints?|validations?|feature[\s-]+(?:gates?|gating|flags?))\b/i;

const VERB = /^(removed?|removes|dropped|deprecated?|deprecates|stabili[sz]ed)\b/i;

/** Backticked words that are syntax, not an API anyone imports. */
const NOT_AN_API = new Set(['null', 'true', 'false', 'undefined', 'none', 'some', 'ok', 'err', 'self']);

/**
 * Changesets and release-plz prefix every bullet with links, a commit hash
 * and an author: `[#1669](…) [`683e1db`](…) Thanks [@denbite](…)! - Remove …`
 * and `[#4363](…)(@pbeza): *(contract)* Drop …`. The verb test needs the
 * sentence they wrap.
 */
export function bulletSentence(line: string): string {
  return line
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/\[#\d+\]\([^)]*\)/g, '')
    .replace(/\[`[0-9a-f]{7,40}`\]\([^)]*\)/g, '')
    .replace(/Thanks\s+\[@[^\]]+\]\([^)]*\)!?\s*-?\s*/g, '')
    .replace(/\(@[\w-]+\):?/g, '')
    .replace(/\*\([^)]*\)\*/g, '')
    .replace(/\(#\d+\)|\(\s*\)/g, '')
    .replace(/^[\s:-]+/, '')
    // "**Breaking:** Removed …" and conventional-commit "feat!: remove …"
    // put a label before the verb.
    .replace(/^(?:\*\*[^*]+\*\*:?|[a-z]+(?:\([^)]*\))?!?:)\s*/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function backticked(text: string): string[] {
  return [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim()).filter((s) => s && !NOT_AN_API.has(s.toLowerCase()));
}

/**
 * The identifiers the verb applies to. Up to six words may sit between the
 * verb and the first backtick ("Remove no longer maintained packages `x`")
 * but no colon or full stop: in "Remove gas rewards: executing a
 * `FunctionCall` no longer pays …" the backticked word is context, not the
 * thing removed. The span ends at the first word that is not a list
 * separator.
 */
const LIST = String.raw`(\`[^\`]+\`(?:\s*(?:,\s*(?:and|or)?|\/|and|or|&)\s*\`[^\`]+\`)*)`;

/**
 * "Removed deprecated fields from `EpochConfig`, …: `num_block_…`, …" names
 * the containers first and the removed fields after the colon (nearcore
 * 2.12.0). A preposition in the gap means the first list is where, not what.
 */
function removedSpan(sentence: string): string[] {
  const afterVerb = sentence.replace(VERB, '');
  const m = afterVerb.match(new RegExp(String.raw`^((?:\s+[^\`\s:.]+){0,6}?)\s*${LIST}`, 'i'));
  if (!m) return [];
  const gap = m[1];
  if (HOUSEKEEPING.test(gap)) return [];
  if (/\b(?:from|in|of|on)\s*$/i.test(gap)) {
    const afterColon = afterVerb.slice(m.index! + m[0].length).match(new RegExp(String.raw`^\s*:\s*${LIST}`));
    return afterColon ? backticked(afterColon[1]) : [];
  }
  if (NOT_AN_INTERFACE.test(afterVerb.slice(m.index! + m[0].length))) return [];
  return backticked(m[2]);
}

export function extractReleaseRemovals(body: string): ReleaseRemoval[] {
  const out: ReleaseRemoval[] = [];
  let skipping = false;
  // GitHub serves release notes with CRLF line ends. Split on \n alone and
  // every line keeps a \r that `.` will not match, so no heading is ever
  // seen and nearcore 2.13.0's "[NOTE]" upgrade steps read as removals.
  for (const raw of body.split(/\r?\n/)) {
    const heading = raw.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      skipping = SKIP_SECTION.test(heading[1]);
      continue;
    }
    if (skipping || !/^\s*[-*+]\s/.test(raw)) continue;
    const sentence = bulletSentence(raw);
    const verb = sentence.match(VERB);
    if (!verb) continue;
    const stabilised = /^stabili/i.test(verb[1]);
    if (stabilised && !/\brenamed?\b/i.test(sentence)) continue;
    const removed = stabilised ? backticked(sentence).slice(0, 1) : removedSpan(sentence);
    if (removed.length === 0) continue;
    out.push({
      action: /^(?:deprecat|stabili)/i.test(verb[1]) ? 'deprecated' : 'removed',
      removed,
      mentioned: backticked(sentence),
      line: sentence.slice(0, 400),
    });
  }
  return out;
}

export interface DocsMarker {
  method: string;
  replacement: string | null;
  line: string;
}

/**
 * The RPC reference pages are generated from nearcore's OpenAPI spec and
 * open with `/openapi.json post /<method>`; a deprecated method's
 * description starts with `[Deprecated]` and usually names its successor
 * ("Consider using send_tx instead", "Consider genesis_config instead").
 */
export function extractDocsMarker(content: string): DocsMarker | null {
  const method = content.match(/^\/openapi\.json\s+post\s+\/(\S+)/m)?.[1];
  // The method's own description is the first line after the spec header; a
  // `[Deprecated]` further down describes a parameter or a field, not the method.
  const head = content.split(/\r?\n/).filter((l) => l.trim()).slice(0, 3);
  const line = head.find((l) => /^\[Deprecated\]/.test(l));
  if (!method || !line) return null;
  const replacement = line.match(/Consider (?:using )?`?([A-Za-z_][\w.]*)`? instead/i)?.[1] ?? null;
  return { method, replacement, line: line.trim().slice(0, 400) };
}
