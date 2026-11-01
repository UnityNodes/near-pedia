/** Strict YYYY-MM-DD parse used anywhere a CIP header date needs to become a
 *  real ISO date instead of being trusted verbatim - CIP frontmatter dates
 *  are free-text typed by the author, so values like 'TBD' or a mistyped
 *  day-of-month need to fail closed (return null) rather than propagate into
 *  schema.org dateModified or similar machine-read fields. */
export function parseCipDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  // Round-trip through Date so 2025-02-31 is rejected rather than rolled
  // forward into a March date the CIP never claimed.
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

function parseKeyValueBlock(block: string): Record<string, string> {
  const lines = block.split('\n');
  const result: Record<string, string> = {};
  let lastKey: string | null = null;

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      if (lastKey && line.trim()) {
        result[lastKey] += ', ' + line.trim();
      }
      continue;
    }
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) {
      result[key] = value;
      lastKey = key;
    }
  }

  return result;
}

function parseMdBoldBlock(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lineRegex = /^\*\*([^*:]+):\*\*\s*(.+)$/gm;
  let m;
  while ((m = lineRegex.exec(content)) !== null) {
    const key = m[1].trim();
    const value = m[2].trim();
    if (key) result[key] = value;
  }
  return result;
}

export function parseCipFrontmatter(content: string): Record<string, string> {
  const preMatch = content.match(/<pre>([\s\S]*?)<\/pre>/i);
  if (preMatch) return parseKeyValueBlock(preMatch[1]);

  const brokenMatch = content.match(/(?:^|\n)\s*<\/pre>\s*\n([\s\S]*?)<\/pre>/i);
  if (brokenMatch) return parseKeyValueBlock(brokenMatch[1]);

  const mdBold = parseMdBoldBlock(content);
  if (mdBold['Title'] ?? mdBold['Status']) return mdBold;

  return {};
}

/**
 * NEAR CIPs carry their metadata as a leading markdown TABLE, not YAML or
 * <pre>. Shared by sync-cips and backfill-cip-history so both read a status the
 * same way - a mismatch between them would invent phantom transitions.
 */
export function parseTableFrontmatter(content: string): {
  meta: Record<string, string>;
  body: string;
} {
  const lines = content.split('\n');
  const meta: Record<string, string> = {};
  let i = 0;

  // skip any leading blank lines
  while (i < lines.length && lines[i].trim() === '') i++;

  let consumedAny = false;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '') {
      // blank line ends the preamble only once we've seen at least one row
      if (consumedAny) {
        i++;
        break;
      }
      continue;
    }
    if (!trimmed.startsWith('|')) {
      // first non-table line => start of body
      break;
    }

    // split markdown table cells; drop the leading/trailing empty cells
    const cells = trimmed.split('|').map((c) => c.trim());
    // cells looks like ['', 'key', 'value', ''] (or more for padded tables)
    const inner = cells.slice(1, -1).map((c) => c.trim());

    // separator row, e.g. | - | - |  or  |----|----|
    const isSeparator =
      inner.length > 0 && inner.every((c) => /^:?-+:?$/.test(c.replace(/\s/g, '')));
    if (isSeparator) {
      consumedAny = true;
      continue;
    }

    if (inner.length >= 2) {
      const key = inner[0].toLowerCase();
      // value may contain further pipes (rare); rejoin everything after the key
      const value = inner.slice(1).join(' | ').trim();
      if (key) {
        meta[key] = value;
        consumedAny = true;
      }
    }
  }

  const body = lines.slice(i).join('\n').replace(/^\s+/, '');
  return { meta, body };
}
