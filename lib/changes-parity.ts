export interface FeedItem { kind: string; when: string }

const MINUTE_MS = 60_000;

const parseWhen = (when: string): number => Date.parse(when.includes('T') ? when : `${when.replace(' ', 'T')}Z`);

function oldest(items: FeedItem[]): number {
  let min = Infinity;
  for (const i of items) {
    const t = parseWhen(i.when);
    if (!Number.isNaN(t) && t < min) min = t;
  }
  return min;
}

export function kindMismatches(
  rest: { items: FeedItem[]; total: number },
  mcp: { items: FeedItem[]; total: number },
): { onlyRest: string[]; onlyMcp: string[] } {
  const restCut = rest.items.length < rest.total;
  const mcpCut = mcp.items.length < mcp.total;
  let floor = -Infinity;
  if (restCut || mcpCut) {
    const edges = [restCut ? oldest(rest.items) : -Infinity, mcpCut ? oldest(mcp.items) : -Infinity];
    floor = Math.max(...edges) + MINUTE_MS;
  }
  const kinds = (items: FeedItem[]) => new Set(items.filter(i => parseWhen(i.when) >= floor).map(i => i.kind));
  const r = kinds(rest.items);
  const m = kinds(mcp.items);
  return {
    onlyRest: [...r].filter(k => !m.has(k)),
    onlyMcp: [...m].filter(k => !r.has(k)),
  };
}
