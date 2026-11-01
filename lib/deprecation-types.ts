/**
 * The shapes the deprecation engine works in. An entry says what is stale,
 * how sure we are, what to use instead and how code that uses it can be
 * recognised; every entry rests on evidence rows, each with a source URL.
 */

export type Strength = 'strong' | 'medium' | 'weak';
/**
 * `superseded`: still supported, but its maintainers recommend a successor
 * (Wallet Selector during the HOT Connect transition). Calling that
 * "deprecated" overstated what its own README says.
 */
export type Status = 'removed' | 'deprecated' | 'superseded' | 'changed' | 'possibly_deprecated';

/** Severity order for merging two signals about one subject: the more severe claim wins. */
export const STATUS_RANK: Record<Status, number> = { removed: 5, deprecated: 4, superseded: 3, changed: 2, possibly_deprecated: 1 };
export type EntryKind = 'package' | 'crate' | 'repo' | 'rpc_method' | 'protocol' | 'api' | 'service' | 'config' | 'product';

/**
 * Where a piece of evidence comes from. The six automatic signals of the
 * engine, plus the kinds a curated entry can cite.
 */
export type Signal =
  | 'repo_archived'
  | 'readme_notice'
  | 'registry_flag'
  | 'release_removal'
  | 'docs_marker'
  | 'docs_removed'
  | 'dormant_with_successor'
  | 'docs_statement'
  | 'governance'
  | 'ecosystem_list'
  | 'probe'
  | 'registry_activity';

/**
 * How code that uses the stale thing can be recognised. check_code reads
 * these; nothing here is a fuzzy pattern, each value is matched exactly.
 */
export interface Matchers {
  npm?: string[];
  crates?: string[];
  /** Module specifiers as written in an import or `use` (`near-sdk-js`, `near_sdk::json_types`). */
  imports?: string[];
  /** Code identifiers: types, functions, actions, error variants. */
  identifiers?: string[];
  rpc?: string[];
  urls?: string[];
  /** Config keys or values (`state_sync.sync`, `ExternalStorage`). */
  config?: string[];
}

export interface Evidence {
  signal: Signal;
  strength: Strength;
  source_url: string;
  /** The words at source_url that carry the claim, verbatim. */
  quote: string | null;
  /** The upstream date of the claim when the source states one (a release date, a docs date). */
  upstream_date: string | null;
  /** False for counter-evidence: the thing still being published, say. */
  supports: boolean;
}

export interface Entry {
  id: string;
  title: string;
  kind: EntryKind;
  status: Status;
  summary: string;
  replacement: string | null;
  replacement_url: string | null;
  since: string | null;
  /** When it bites, if not at once: a protocol version, a node version. */
  effective: string | null;
  matchers: Matchers;
  /** Keys that identify the same subject across signals: `github:near/near-sdk-js`, `npm:near-sdk-js`, `id:DelegateV2`. */
  subjects: string[];
  origin: 'seed' | 'signal';
  evidence: Evidence[];
}

export const STRENGTH_RANK: Record<Strength, number> = { strong: 3, medium: 2, weak: 1 };

export function strongest(levels: readonly Strength[]): Strength | null {
  return levels.reduce<Strength | null>((best, s) => (!best || STRENGTH_RANK[s] > STRENGTH_RANK[best] ? s : best), null);
}
