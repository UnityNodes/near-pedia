export interface PaperAuthor {
  name: string;
  role?: string;
  organization?: boolean;
}

export interface WhitepaperMeta {
  publisher: string;
  author?: PaperAuthor;
  date: string;
  dateNote: string;
}

export type WhitepaperMetaTable = Readonly<Record<string, WhitepaperMeta>>;

export const FOUNDATIONAL_SLUG: string | null = null;

export const WHITEPAPER_META: WhitepaperMetaTable = {};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatPaperDate(date: string | null | undefined): string {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date ?? '');
  if (!m) return '';
  const [, y, mo, d] = m;
  if (!mo) return y;
  const month = MONTHS[Number(mo) - 1];
  if (!month) return y;
  return d ? `${month} ${Number(d)}, ${y}` : `${month} ${y}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export interface PaperFacts {
  publisher: string;
  author?: PaperAuthor;
  authorLabel?: string;
  date: string | null;
  dateLabel: string;
  dateNote?: string;
  description: string | null;
  sourceHost: string;
  sourceAction: string;
  isPdf: boolean;
}

export function paperFacts(wp: { slug: string; description: string | null; pdf_url: string }, table: WhitepaperMetaTable = WHITEPAPER_META): PaperFacts {
  const meta = table[wp.slug];
  const sourceHost = hostOf(wp.pdf_url);
  const isPdf = /\.pdf(?:$|[?#])/i.test(wp.pdf_url);
  return {
    publisher: meta?.publisher ?? (sourceHost || 'Unknown publisher'),
    author: meta?.author,
    authorLabel: meta?.author ? [meta.author.name, meta.author.role].filter(Boolean).join(', ') : undefined,
    date: meta?.date ?? null,
    dateLabel: formatPaperDate(meta?.date),
    dateNote: meta?.dateNote,
    description: wp.description,
    sourceHost,
    sourceAction: isPdf ? 'Open the PDF' : `Open on ${sourceHost || 'the source'}`,
    isPdf,
  };
}

export function newestFirst<T extends { slug: string }>(papers: readonly T[], table: WhitepaperMetaTable = WHITEPAPER_META): T[] {
  const dateOf = (p: T) => table[p.slug]?.date ?? '';
  return [...papers].sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || a.slug.localeCompare(b.slug));
}
