/**
 * Columns whose stored shape is NOT what the default contract would assume.
 *
 * check-formats derives its surface from the data rather than from a list here,
 * so a table added tomorrow is covered without anyone remembering to register
 * it. This file can only ever REMOVE coverage, and every removal has to say why
 * in a sentence. That is deliberate: a registry that has to be extended for new
 * coverage goes stale silently, and a registry that has to be extended to drop
 * coverage cannot.
 */

/** How a column's values are meant to be read. */
export type Format = 'date' | 'json' | 'url' | 'epoch_ms' | 'epoch_s' | 'semver' | 'opaque';

/**
 * Strict semantic version, at most three numeric components.
 *
 * "At most three" is what keeps an IPv4 address or a build number out of a
 * looser pattern's net.
 */
export const SEMVER_RE = /^v?\d+\.\d+(\.\d+)?(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/** Numeric ordering for a semver string; non-semver sorts last, stably. */
export function semverKey(v: string): number[] {
  if (!SEMVER_RE.test(v)) return [Infinity];
  const core = v.replace(/^v/, '').split(/[-+]/)[0].split('.').map(Number);
  return [core[0] ?? 0, core[1] ?? 0, core[2] ?? 0];
}

/**
 * NOW, in the exact shape sync_log.ran_at (and other ISO-with-milliseconds
 * columns) are stored in, so a comparison stays on bare column values and can
 * use an index.
 *
 * WHY NOT `datetime(col) >= datetime('now', ...)`, which also works: that puts
 * a function on the column side and gives up any index on it. Generating the
 * BOUNDARY in the stored shape leaves the column bare and comparable.
 *
 * `modifier` is a SQLite date modifier, either a literal like `'-30 days'` or a
 * placeholder for a bound one. Omit it for "right now".
 *
 * Pre-existing on nearpedia (used by check-agent-errors.ts and
 * check-upstream-echo.ts); kept here rather than moved so this port does not
 * touch either caller's import.
 */
export function isoNowSql(modifier?: string): string {
  return `strftime('%Y-%m-%dT%H:%M:%fZ', 'now'${modifier ? `, ${modifier}` : ''})`;
}

export interface Exception {
  table: string;
  column: string;
  /** What it really is. `opaque` means: not machine-parsed, do not parse it. */
  format: Format;
  why: string;
}

/**
 * Integer columns that hold a point in time. The unit is the whole contract and
 * the column name does not carry it: forty-odd TEXT columns named `*_at` hold
 * ISO-8601 while these hold milliseconds since epoch, so any helper keyed on
 * the name alone is wrong about one of them. Declared here and asserted
 * against the stored values, so a seconds value written into an ms column
 * lands in 1970 and is caught rather than rendered.
 */
export const EPOCH_UNITS: Exception[] = [
  { table: 'search_log', column: 'timestamp', format: 'epoch_ms', why: 'Date.now() at write' },
  { table: 'csp_violation_log', column: 'timestamp', format: 'epoch_ms', why: 'Date.now() at write' },
  { table: 'contact_submissions', column: 'timestamp', format: 'epoch_ms', why: 'Date.now() at write' },
  { table: 'embedding_doc_hash', column: 'updated_at', format: 'epoch_ms', why: 'Date.now() at write; the only *_at column in the schema that is not ISO text' },
  { table: 'log_rollup', column: 'since_ms', format: 'epoch_ms', why: 'window start, Date.now() arithmetic' },
];

/**
 * Columns that LOOK like a parsed format and deliberately are not.
 *
 * Each of these was reached by asking who reads the column, not by wanting the
 * check to go green. A column landing here is a promise that nothing parses it,
 * and for date-shaped ones check-formats proves that behaviourally by running
 * every exported formatter over every stored value.
 */
export const OPAQUE: Exception[] = [
  {
    table: 'forum_topics', column: 'title', format: 'opaque',
    why:
      'A thread title as its author wrote it. Monthly reports put the month in it ("[Report] MotionDAO April 2022"), ' +
      'which reads as a date to a sniffer; it is fenced and shown as text, never parsed.',
  },
  {
    table: 'github_discussions', column: 'body', format: 'opaque',
    why:
      'A GitHub Discussion body in Markdown. Some are a bare link to a proposal; all are fenced and shown as text, never parsed as a URL.',
  },
  {
    table: 'deprecations', column: 'replacement', format: 'opaque',
    why:
      'What to use instead, as a sentence ("send_tx", "a KeyPairSigner, or ..."); a few entries name a successor repository by its URL. ' +
      'The URL that is followed lives in replacement_url; this column is shown as text.',
  },
  {
    table: 'csp_violation_log', column: 'blocked_uri', format: 'opaque',
    why:
      'CSP report field. The spec puts literal tokens here - "inline", "eval", "wasm-eval" - ' +
      'alongside real URLs. Stored for triage, never parsed as a URL.',
  },
  {
    table: 'github_repos', column: 'readme_replacement', format: 'opaque',
    why:
      'The pointer a README deprecation notice gives, as written: "label (url)", a bare URL, or a ' +
      'package name from a code span (lib/github-repos.ts firstLink). Shown as text, never parsed.',
  },
  {
    table: 'csp_violation_log', column: 'source_file', format: 'opaque',
    why:
      'Browser-supplied, and Chrome sends a bare scheme ("chrome-extension", "about") for ' +
      'violations it will not attribute to a file. Stored for triage, never parsed.',
  },
];

// ── semantics, not shape ────────────────────────────────────────────────────

/**
 * Pairs of columns in one table where the first names an event that cannot come
 * after the second.
 *
 * Every gate before this one asks whether a value is WELL FORMED. A value can be
 * a perfect ISO-8601 timestamp and still be the wrong moment, and nothing so far
 * would notice: `first_seen` after `last_seen`, a `synced_at` in 2031, a
 * `created_at` later than the `updated_at` of the same row. This is the smallest
 * honest thing that can be asserted about the instant itself, because it needs
 * no outside truth - the row contradicts itself.
 *
 * Names, not a per-table list, so a new table carrying the same pair is checked
 * the day it exists. A pair is only asserted where both columns are present AND
 * both actually hold dates.
 */
export const ORDER_PAIRS: [string, string][] = [
  ['first_seen', 'last_seen'],
  ['first_seen', 'last_check_at'],
  ['created_at', 'updated_at'],
  ['created_at', 'synced_at'],
  ['created_at', 'posted_at'],
  ['created_date', 'approved_date'],
  ['published_at', 'synced_at'],
  ['first_post_at', 'last_post_at'],
  ['start_at', 'end_at'],
];

/**
 * Columns whose values are ALLOWED to be in the future, because that is what
 * they mean. Everything else describing something that already happened must
 * not be, and a clock skew or a unit slip is how it gets there.
 */
export const FUTURE_IS_LEGITIMATE = /^(expires_at|deadline|effective_at|target_effective_at|start_at|end_at|vote_before|available_after|claimed_expires_at|round_effective_at|voting_ends_at|timelock_ends_at)$/;
