const CITE = /\[(\d{1,2})\](?!\()/g;
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/;

export function citeId(turnId: string, n: number): string {
  return `ak-src-${turnId}-${n}`;
}

function outsideCode(text: string, fn: (prose: string) => string): string {
  return text.split(CODE).map((part, i) => (i % 2 === 1 ? part : fn(part))).join('');
}

/** Turns the model's [n] into links to source n of this answer, leaving code spans and fences as written. */
export function linkCitations(text: string, turnId: string, count: number): string {
  return outsideCode(text, (prose) => prose.replace(CITE, (whole, d: string) => {
    const n = Number(d);
    return n >= 1 && n <= count ? `[${n}](#${citeId(turnId, n)})` : whole;
  }));
}

/** The source numbers the answer's prose cites. */
export function citedNumbers(text: string): Set<number> {
  const found = new Set<number>();
  outsideCode(text, (prose) => {
    for (const m of prose.matchAll(CITE)) found.add(Number(m[1]));
    return prose;
  });
  return found;
}
