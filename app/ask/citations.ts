const CITE = /\[(\d{1,2})\](?!\()/g;
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/;

export function citeId(turnId: string, n: number): string {
  return `ak-src-${turnId}-${n}`;
}

function outsideCode(text: string, fn: (prose: string) => string): string {
  return text.split(CODE).map((part, i) => (i % 2 === 1 ? part : fn(part))).join('');
}

export function linkCitations(text: string, turnId: string, count: number): string {
  return outsideCode(text, (prose) => prose.replace(CITE, (whole, d: string) => {
    const n = Number(d);
    return n >= 1 && n <= count ? `[${n}](#${citeId(turnId, n)})` : whole;
  }));
}

export function citedNumbers(text: string): Set<number> {
  const found = new Set<number>();
  outsideCode(text, (prose) => {
    for (const m of prose.matchAll(CITE)) found.add(Number(m[1]));
    return prose;
  });
  return found;
}

export function copyText(answer: string, sources: ReadonlyArray<{ n: number; title: string; url: string | null; as_of: string | null }>): string {
  const cited = citedNumbers(answer);
  const lines = sources.filter((s) => cited.has(s.n))
    .map((s) => `[${s.n}] ${s.title}${s.url ? ` - ${s.url}` : ''}${s.as_of ? ` (read ${s.as_of.slice(0, 10)})` : ''}`);
  return lines.length ? `${answer.trim()}\n\nSources:\n${lines.join('\n')}` : answer.trim();
}
