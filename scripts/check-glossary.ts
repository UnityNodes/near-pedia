import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { parseHeadingGlossary, parseQuoteGlossary } from '../lib/glossary-source';
import { LEGACY_ANCHORS, PRIMARY_GLOSSARY_URL, REFERENCE_GLOSSARY_URL, getGlossary } from '../lib/glossary';

export function rawPrimaryTerms(html: string): number {
  return (html.match(/<h3\b[^>]*\bid="[^"]+"/g) ?? []).length;
}

export function rawReferenceEntries(html: string): number {
  const start = html.indexOf('<div class="glossary">');
  if (start === -1) return 0;
  return (html.slice(start).match(/<span data-as="p">[\s\S]*?<\/span>\s*<(?:blockquote|ul)>/g) ?? []).length;
}

export function glossaryProblems(rows: { url: string; content_html: string | null }[], entryIds: string[], legacy: Record<string, string> = LEGACY_ANCHORS): string[] {
  const problems: string[] = [];
  const primary = rows.find(r => r.url === PRIMARY_GLOSSARY_URL)?.content_html ?? null;
  const reference = rows.find(r => r.url === REFERENCE_GLOSSARY_URL)?.content_html ?? null;

  if (!primary) problems.push(`the official glossary (${PRIMARY_GLOSSARY_URL}) is not held, so /glossary shows the hand-written fallback`);
  else {
    const raw = rawPrimaryTerms(primary);
    const parsed = parseHeadingGlossary(primary).length;
    if (raw === 0) problems.push('the official glossary page holds no term headings: upstream changed its markup');
    else if (parsed < raw) problems.push(`the official glossary has ${raw} term headings and ${parsed} parsed: upstream changed the markup of ${raw - parsed}`);
  }

  if (!reference) problems.push(`the reference glossary (${REFERENCE_GLOSSARY_URL}) is not held`);
  else {
    const raw = rawReferenceEntries(reference);
    const { terms, aliases } = parseQuoteGlossary(reference);
    if (raw === 0) problems.push('the reference glossary page holds no entries: upstream changed its markup');
    else if (terms.length + aliases.length < raw) problems.push(`the reference glossary has ${raw} entries and ${terms.length + aliases.length} parsed`);
  }

  const ids = new Set(entryIds);
  for (const [from, to] of Object.entries(legacy)) {
    if (!ids.has(to)) problems.push(`the old anchor #${from} points at #${to}, which no term has any more`);
  }
  return problems;
}

function main(): void {
  const db = getDb();
  const rows = db.prepare('SELECT url, content_html FROM doc_pages WHERE url IN (?, ?)').all(PRIMARY_GLOSSARY_URL, REFERENCE_GLOSSARY_URL) as { url: string; content_html: string | null }[];
  const { entries } = getGlossary();
  const problems = glossaryProblems(rows, entries.map(e => e.id));
  for (const p of problems) console.error(`  ${p}`);
  console.log(problems.length
    ? `[check-glossary] ${problems.length} problem(s); /glossary has ${entries.length} terms`
    : `[check-glossary] ${entries.length} terms, every heading of both glossaries parsed, old anchors resolve`);
  logRun('check-glossary', {
    status: problems.length ? 'partial' : 'success',
    items: entries.length,
    error: problems.length ? problems.join(' ; ').slice(0, 1000) : undefined,
  });
  if (problems.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error('check-glossary failed:', err);
    logRun('check-glossary', { status: 'error', items: 0, error: String(err).slice(0, 1000) });
    process.exit(1);
  }
}
