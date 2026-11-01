/**
 * Canonical CIP-id normalization shared by mcp-server.ts (Express REST)
 * and Next route handlers.
 *
 * Input forms accepted from external callers:
 *   "42"          → "0042"
 *   "0042"        → "0042"
 *   "CIP-42"      → "0042"
 *   "cip-0042"    → "0042"
 *   "PR-117"      → "PR-117"
 *   "pr-117"      → "PR-117"
 *
 * Storage form (cips.id column) is the canonical right-hand value.
 *
 * Returns null when the input can't be normalized - caller should
 * 400/404 rather than guess.
 */

import { fenceUntrustedInline } from './untrusted-fence';

const PR_PREFIX_RE = /^PR-/i;
const CIP_PREFIX_RE = /^CIP-/i;
const NUMERIC_RE = /^\d+$/;
const PR_VALID_RE = /^PR-\d+$/;

/** Structural subset of the DB handle resolveCipId needs, so callers can pass
 *  either better-sqlite3's Database or a narrower test double. */
interface CipIdLookup {
  prepare(sql: string): { get(...args: unknown[]): unknown };
}

export function normalizeCipId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // PR-form keeps its prefix, just uppercase + digit-validate.
  if (PR_PREFIX_RE.test(trimmed)) {
    const upper = trimmed.toUpperCase();
    return PR_VALID_RE.test(upper) ? upper : null;
  }

  // Numeric form (with or without CIP- prefix) → 4-digit padded.
  const stripped = trimmed.replace(CIP_PREFIX_RE, '');
  if (!NUMERIC_RE.test(stripped)) return null;
  // Reject CIP-99999+ since the storage column never exceeds 4 digits
  // today, and silently padding a 5-digit id would produce wrong rows.
  if (stripped.length > 4) return null;
  return stripped.padStart(4, '0');
}

/**
 * normalizeCipId plus a fallback: a bare 4-digit numeric id that misses a
 * merged CIP row is retried as `PR-<digits>` before giving up, so a caller who
 * doesn't know whether "0117" is a merged CIP or an open-PR draft still
 * resolves to the row that actually exists. Additive by construction — an id
 * that resolves today resolves to the same row, since the alias is only
 * consulted after the direct lookup misses.
 */
export function resolveCipId(db: CipIdLookup, raw: string | null | undefined): string | null {
  const clean = normalizeCipId(raw);
  if (!clean) return null;
  try {
    const exists = db.prepare('SELECT 1 AS ok FROM cips WHERE id = ?');
    if (exists.get(clean)) return clean;
    if (/^\d{4}$/.test(clean) && exists.get(`PR-${clean}`)) return `PR-${clean}`;
  } catch {
    // Table missing or mid-migration: fall through to the pure answer rather
    // than turn a lookup failure into an "invalid id".
  }
  return clean;
}

/**
 * True for a CIP ingested from an OPEN pull request against your-org/CIPs
 * rather than a merged, reviewed CIP - anyone can open one. No sync script
 * currently populates PR-prefixed rows (confirmed: none exist in the table
 * today), but the id format and normalizeCipId's handling of it already
 * anticipate the case, so title/author/body fields for a row in this shape
 * get treated as unreviewed community text, not merged-CIP curated content,
 * the moment one does show up.
 */
export function isOpenPrDraft(id: string | null | undefined): boolean {
  return typeof id === 'string' && PR_VALID_RE.test(id.toUpperCase());
}

/**
 * A CIP row's own text (title, status, author) for MCP tool output: passed
 * through for a merged CIP, inline-fenced for an open-PR draft. Mirrors
 * docField's role for doc_pages - the field rides above a body that gets
 * the same treatment at each call site.
 */
export function cipField(id: string | null | undefined, v: string | null | undefined): string {
  const t = (v ?? '').trim();
  if (t === '') return t;
  return isOpenPrDraft(id) ? fenceUntrustedInline(t) : t;
}
