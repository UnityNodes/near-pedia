/**
 * A documentation code block survives extraction as multi-line text.
 *
 * THE CLASS. A doc crawler turns HTML into the content_text that get_doc serves,
 * docs_fts indexes and build-embeddings embeds. If it builds that text by
 * concatenating node text and collapsing whitespace, every <pre> code block,
 * every table and every list lands on a single line: a shell script becomes one
 * run-on line that breaks when an agent copies it, and a comparison table
 * becomes word salad ("projectsdk startcli sandbox"). The structure is not
 * noise a chrome-stripper can catch later - it is gone from the stored text.
 *
 * WHY NO CHECK SAW IT. check-doc-chrome finds ADDED furniture (a banner, a nav);
 * check-corpus-text finds markup left IN the text (a high tag ratio) and bodies
 * that went missing against upstream. Flattening adds nothing and removes
 * nothing a byte-count or tag-ratio can see: the same words, the newlines gone.
 * three template doc sources (1352, 89 and 42 pages) each
 * sat at ZERO newlines under a green board while every other doc source was
 * 100% multi-line, because sync-docs.ts alone built content_text from `.text`
 * plus `\s+`->space instead of htmlToTextWithCode like every other doc sync.
 *
 * WHAT THIS ASSERTS. For each page whose content_html carries a MULTI-LINE <pre>
 * (a real code block, not a one-line command), the stored content_text must
 * itself carry a newline. A page that has the code block in its HTML but serves
 * it single-line has flattened it. The content_html is the independent witness:
 * it is the structure the text is supposed to have preserved, read from a column
 * this check never writes.
 *
 * Negative control: scripts/break-doc-structure.ts
 *
 *   npx tsx scripts/check-doc-structure.ts
 */

import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';

/**
 * How many <pre> blocks in this HTML are MULTI-LINE code (a newline or a <br>
 * inside, and more than a token's worth of text). A one-line <pre> is a single
 * command and legitimately produces newline-free text, so it is not counted:
 * counting it would flag pages that are correct.
 */
function multilinePreCount(html: string): number {
  let n = 0;
  for (const m of html.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi)) {
    const inner = m[1];
    const looksMultiline = /\n/.test(inner) || /<br\b/i.test(inner);
    const textLen = inner.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').trim().length;
    if (looksMultiline && textLen > 40) n++;
  }
  return n;
}

function main(): void {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, url, source, content_html, content_text
         FROM doc_pages
        WHERE content_html IS NOT NULL AND content_text IS NOT NULL`,
    )
    .all() as Array<{ id: number; url: string; source: string; content_html: string; content_text: string }>;

  const bySource = new Map<string, { flat: number; withCode: number; sample: string }>();
  let flatPages = 0;
  let codePages = 0;

  for (const r of rows) {
    if (multilinePreCount(r.content_html) === 0) continue; // nothing to flatten
    codePages++;
    const s = bySource.get(r.source) ?? { flat: 0, withCode: 0, sample: '' };
    s.withCode++;
    if (!r.content_text.includes('\n')) {
      s.flat++;
      flatPages++;
      if (!s.sample) s.sample = r.url;
    }
    bySource.set(r.source, s);
  }

  const problems: string[] = [];
  for (const [src, s] of bySource) {
    if (s.flat > 0) {
      problems.push(
        `${src}: ${s.flat} of ${s.withCode} page(s) with a multi-line code block in HTML `
        + `store it as single-line text (structure flattened), e.g. ${s.sample}`,
      );
    }
  }

  for (const p of problems) console.error(`  ${p}`);

  logRun('doc-structure', {
    status: problems.length ? 'error' : 'success',
    items: rows.length,
    error: problems.length ? problems.slice(0, 3).join(' | ').slice(0, 900) : undefined,
  }, db);

  console.log(
    problems.length
      ? `[check-doc-structure] ${flatPages} page(s) across ${problems.length} source(s) flatten multi-line code out of ${codePages} code page(s)`
      : `[check-doc-structure] ${codePages} of ${rows.length} doc page(s) carry a multi-line code block; every one keeps its newlines in the served text`,
  );
  if (problems.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error('check-doc-structure failed:', err);
    logRun('doc-structure', { status: 'error', error: String(err).slice(0, 500) });
    process.exit(1);
  }
}
