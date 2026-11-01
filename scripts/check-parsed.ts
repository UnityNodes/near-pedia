/**
 * Do the fields we SERVE still say what the source they came from says?
 *
 * Every other standing check answers "do we hold the same records as
 * upstream". None answers "did we read them correctly". That gap is the
 * quietest kind: the counts agree, the sets agree, and the content is wrong.
 *
 * The method is cheap because we keep the raw source: `cips.content_md` is
 * the markdown as fetched. Re-parse it with the same parser the sync uses
 * (parseTableFrontmatter, lib/parsers/cip-frontmatter.ts) and compare, field
 * by field, with what is stored. A disagreement means one of
 *
 *   - the sync wrote a field from somewhere other than the source
 *   - the parser changed and nothing re-ran it over existing rows
 *   - something edited the row after the fact
 *
 * NO NETWORK. Deliberately. This is not "did upstream change", which
 * check-completeness already covers; it is "is our stored interpretation
 * still consistent with our stored evidence". Keeping it offline means it
 * can run on every tick without asking anything of anyone else's servers.
 *
 * WHAT IS NOT COVERED. Only the CIP domain applies here.
 * get_network_state calls external APIs live on every request rather than
 * deriving served numbers from a stored payload, so there is no "did we
 * re-derive it correctly" question to ask offline.
 *
 * Also excluded: `title` - sync-cips.ts falls back to a markdown-heading regex when the frontmatter
 * table has no `title` row, and comparing a value that is not purely a
 * frontmatter reflection would report that fallback as a defect. `approved`
 * and `license` are not in RULES either: sync-cips.ts writes them as a
 * literal `null` with the comment "not present in YourChain frontmatter" -
 * confirmed against a real CIP's table (cip-0001 has cip/title/author/
 * status/type/created and nothing else) - so there is no source value either
 * side of a comparison could ever hold.
 *
 *   npx tsx scripts/check-parsed.ts
 *   npx tsx scripts/check-parsed.ts --verbose   # every disagreement, not a sample
 */

import { getDb } from '../lib/db';
import { guardSync, logRun } from '../lib/sync-log';
import { parseTableFrontmatter } from '../lib/parsers/cip-frontmatter';

const VERBOSE = process.argv.includes('--verbose');
const SAMPLE = 12;

interface Row {
  id: string;
  status: string | null;
  type: string | null;
  author: string | null;
  created_date: string | null;
  requires: string | null;
  content_md: string | null;
}

/** A field of ours, the frontmatter key it comes from, and how to compare. */
interface FieldRule {
  column: keyof Row;
  key: string;
  /**
   * Normalise both sides before comparing. Dates are written more than one
   * way, so a raw string comparison would report formatting as a defect and
   * bury the real ones.
   */
  norm?: (v: string) => string;
}

const isoDate = (v: string): string => {
  const t = v.trim().replace(/[.,;]+$/, '');
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const parsed = Date.parse(t);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : t.toLowerCase();
};

const plain = (v: string): string => v.trim().replace(/\s+/g, ' ').replace(/[.;]+$/, '').toLowerCase();

/**
 * The key spellings come from parseTableFrontmatter, which already lowercases
 * every key it reads (`inner[0].toLowerCase()`), and YourChain's
 * markdown-table preamble has one spelling per field, confirmed by reading sync-cips.ts's own `meta['...']` lookups
 * rather than assumed.
 */
const RULES: FieldRule[] = [
  { column: 'status', key: 'status', norm: plain },
  { column: 'type', key: 'type', norm: plain },
  { column: 'author', key: 'author', norm: plain },
  { column: 'created_date', key: 'created', norm: isoDate },
  { column: 'requires', key: 'requires', norm: plain },
];

interface Disagreement { domain: string; id: string; column: string; stored: string; source: string }

/**
 * CIPs: markdown frontmatter table against the columns the sync wrote from it.
 */
function checkCips(): { findings: Disagreement[]; compared: number; unreadable: number } {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, status, type, author, created_date, requires, content_md
    FROM cips WHERE content_md IS NOT NULL AND content_md != ''
  `).all() as Row[];

  const bad: Disagreement[] = [];
  let unparseable = 0;
  let compared = 0;

  for (const r of rows) {
    const { meta } = parseTableFrontmatter(r.content_md ?? '');
    if (Object.keys(meta).length === 0) {
      // A CIP whose frontmatter table we cannot read at all is its own
      // finding: the stored fields for it came from somewhere this check
      // cannot see.
      unparseable++;
      continue;
    }
    for (const rule of RULES) {
      const source = meta[rule.key];
      const stored = r[rule.column] as string | null;
      // Absent on BOTH sides is agreement, and the common case (requires is
      // empty for 34 of 52 CIPs).
      if ((source === undefined || source === '') && (stored === null || stored === '')) continue;
      compared++;
      const n = rule.norm ?? plain;
      const a = stored ? n(stored) : '';
      const b = source ? n(source) : '';
      if (a !== b) bad.push({ domain: 'cip', id: r.id, column: String(rule.column), stored: stored ?? '(empty)', source: source ?? '(absent)' });
    }
  }

  return { findings: bad, compared, unreadable: unparseable };
}

function main(): void {
  const db = getDb();
  const { findings, compared, unreadable } = checkCips();

  console.log(`  cip   ${String(compared).padStart(6)} field(s) compared, ${findings.length} disagreeing, ${unreadable} unreadable`);
  console.log(`[check-parsed] ${compared} field(s) compared across 1 domain(s), ${findings.length} disagreeing, ${unreadable} unreadable`);
  console.log('  only the cip domain applies here - see docstring');

  const byColumn = new Map<string, number>();
  for (const d of findings) byColumn.set(`${d.domain}.${d.column}`, (byColumn.get(`${d.domain}.${d.column}`) ?? 0) + 1);
  for (const [col, n] of [...byColumn].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${col}`);

  const show = VERBOSE ? findings : findings.slice(0, SAMPLE);
  for (const d of show) {
    console.error(`  ${d.domain.padEnd(4)} ${d.id.padEnd(10)} ${d.column.padEnd(20)} stored "${d.stored.slice(0, 38)}" | source "${d.source.slice(0, 38)}"`);
  }
  if (!VERBOSE && findings.length > SAMPLE) console.error(`  ... and ${findings.length - SAMPLE} more; run with --verbose`);

  logRun('check-parsed', {
    status: findings.length || unreadable ? 'partial' : 'success',
    items: compared,
    error: findings.length || unreadable
      ? `${findings.length} field(s) disagree with the stored source (${[...byColumn].map(([c, n]) => `${c} ${n}`).join(', ')})`
        + (unreadable ? `; ${unreadable} unreadable` : '')
      : undefined,
  }, db);

  if (findings.length || unreadable) process.exitCode = 1;
}

guardSync('check-parsed', main).catch((e) => { console.error(e); process.exitCode = 1; });
