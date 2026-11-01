export interface BlogHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

const HEADING = /<(h[23])(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;

function plain(inner: string): string {
  return inner
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function slugOf(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '') || 'section';
}

export function withHeadingIds(html: string): { html: string; headings: BlogHeading[] } {
  const used = new Set<string>();
  const headings: BlogHeading[] = [];
  const out = html.replace(HEADING, (full: string, tag: string, attrs: string | undefined, inner: string) => {
    const text = plain(inner);
    if (!text) return full;
    const base = slugOf(text);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    headings.push({ id, text, level: tag.toLowerCase() === 'h2' ? 2 : 3 });
    const kept = (attrs ?? '').replace(/\sid\s*=\s*("[^"]*"|'[^']*')/i, '');
    return `<${tag}${kept} id="${id}">${inner}</${tag}>`;
  });
  return { html: out, headings };
}
