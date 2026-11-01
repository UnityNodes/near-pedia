/**
 * A documentation page holds the article, not the site's furniture.
 *
 * THE CLASS. A doc source can arrive with a banner or footer repeated on every
 * page - a platform nav menu, an "Edit this page" link, a "Copy page" control -
 * and it reads as article text to every other check: check-corpus-text finds
 * chrome by POPULATION (many pages at one exact length is a widget, a high tag
 * ratio is markup), but a short shared PREFIX or SUFFIX trips neither. The
 * pages still differ in length, and a nav menu is readable text, not tags. So
 * a banner repeated verbatim on every page of a source is invisible to every
 * check while being the first thing an agent reads.
 *
 * WHAT THIS ASSERTS, two halves - a leading-prefix guard and a trailing-suffix
 * guard, because a banner can sit at either end and neither guard sees the
 * other's shape:
 *
 *   prefix   no source shares a long leading prefix across most of its pages.
 *            A uniform banner prepended to every page is exactly this shape;
 *            a per-page-variable nav is not, and will not trip this.
 *
 *   suffix   the same, on the tail: no source shares a long trailing block
 *            across most of its pages. A feedback footer or a repeated
 *            "Suggest edits" control is this shape; an article's last
 *            paragraph, which varies page to page, is not.
 *
 * WHAT THIS DOES NOT DO. It asserts no "known chrome" regression guard
 * against a `stripDocChrome`/`hasDocChrome` module with source-specific
 * removal rules. yourpedia has no such module and no accumulated rule set -
 * there is nothing to regress yet. If a real banner is found here, the fix is
 * to write the removal rule, and this check's own exempt list grows one
 * deliberate decision at a time, with a reason.
 *
 *   npx tsx scripts/check-doc-chrome.ts
 */

import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';

/** Sources whose long shared prefix is content, not chrome, and why. */
const PREFIX_EXEMPT: Record<string, string> = {};

/** Sources whose long shared suffix is content, not chrome, and why. */
const SUFFIX_EXEMPT: Record<string, string> = {};

/** A source needs this many pages before a shared prefix means anything. */
const MIN_PAGES = 8;
/** A shared prefix at least this long, on at least this fraction, is a banner. */
const PREFIX_LEN = 60;
const PREFIX_COVER = 0.85;

/** The longest leading prefix (>= PREFIX_LEN) shared by >= PREFIX_COVER of the pages. */
function sharedPrefix(norm: string[]): { len: number; cover: number; sample: string } | null {
  for (let L = 200; L >= PREFIX_LEN; L -= 5) {
    const counts = new Map<string, number>();
    for (const a of norm) {
      const p = a.slice(0, L);
      if (p.length === L) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    let top = '', n = 0;
    for (const [k, v] of counts) if (v > n) { n = v; top = k; }
    if (norm.length && n / norm.length >= PREFIX_COVER) return { len: L, cover: n / norm.length, sample: top };
  }
  return null;
}

/** The longest trailing suffix (>= PREFIX_LEN) shared by >= PREFIX_COVER of the pages. */
function sharedSuffix(norm: string[]): { len: number; cover: number; sample: string } | null {
  for (let L = 200; L >= PREFIX_LEN; L -= 5) {
    const counts = new Map<string, number>();
    for (const a of norm) {
      const p = a.slice(-L);
      if (p.length === L) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    let top = '', n = 0;
    for (const [k, v] of counts) if (v > n) { n = v; top = k; }
    if (norm.length && n / norm.length >= PREFIX_COVER) return { len: L, cover: n / norm.length, sample: top };
  }
  return null;
}

function main(): void {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, source, content_text FROM doc_pages WHERE content_text IS NOT NULL`,
  ).all() as Array<{ id: number; source: string; content_text: string }>;

  const problems: string[] = [];

  const bySrc = new Map<string, { head: string; tail: string }[]>();
  for (const r of rows) {
    const norm = r.content_text.replace(/\s+/g, ' ').trim();
    const arr = bySrc.get(r.source) ?? [];
    arr.push({ head: norm.slice(0, 200), tail: norm.slice(-200) });
    bySrc.set(r.source, arr);
  }
  for (const [src, arr] of [...bySrc].sort()) {
    if (arr.length < MIN_PAGES) continue;
    if (!PREFIX_EXEMPT[src]) {
      const sp = sharedPrefix(arr.map(a => a.head));
      if (sp) {
        problems.push(
          `shared-prefix ${src}: ${arr.length} pages share ${sp.len}+ leading chars `
          + `(${Math.round(sp.cover * 100)}%): ${JSON.stringify(sp.sample.slice(0, 70))}`,
        );
      }
    }
    if (!SUFFIX_EXEMPT[src]) {
      const ss = sharedSuffix(arr.map(a => a.tail));
      if (ss) {
        problems.push(
          `shared-suffix ${src}: ${arr.length} pages share ${ss.len}+ trailing chars `
          + `(${Math.round(ss.cover * 100)}%): ${JSON.stringify(ss.sample.slice(-70))}`,
        );
      }
    }
  }

  for (const p of problems) console.error(`  ${p}`);

  logRun('doc-chrome', {
    status: problems.length ? 'error' : 'success',
    items: rows.length,
    error: problems.length ? problems.slice(0, 3).join(' | ').slice(0, 900) : undefined,
  }, db);

  console.log(
    problems.length
      ? `[check-doc-chrome] ${problems.length} problem(s) over ${rows.length} doc page(s)`
      : `[check-doc-chrome] ${rows.length} doc page(s): no source shares an unstripped leading or trailing banner`,
  );
  if (problems.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error('check-doc-chrome failed:', err);
    logRun('doc-chrome', { status: 'error', error: String(err).slice(0, 500) });
    process.exit(1);
  }
}
