/**
 * Single source of truth for the numbers we advertise about the machine-facing
 * surface. Hardcoding them in copy (page metadata, marketing text) is how they
 * drift: /for-ai shipped "22 tools / 38 endpoints" while the server served
 * 23 / 37, and later "37 endpoints" after an endpoint was deleted and the
 * spec dropped to 36.
 *
 * REST_ENDPOINT_COUNT is DERIVED from the OpenAPI spec, so deleting or adding
 * a route updates the advertised number by itself.
 *
 * MCP_TOOL_COUNT was a literal ("keep it in sync when tools are added") -
 * exactly the shape that goes stale the day someone adds a tool and forgets
 * the comment. It's the same file mcp-server.ts can't be imported from (it
 * runs as a separate process), so this reads its source text instead and
 * counts registrations directly.
 *
 * The quote in the pattern matters: without it the count is off by one,
 * because mcp-server.ts has a comment mentioning `server.tool()` in prose
 * ("One-time MCP tool registry probe...") that a bare `server.tool(` would
 * also match. Verified three ways on 2026-08-03: this regex, `grep -c
 * "server.tool('"`, and a live tools/list call all agree at 23.
 */
import fs from 'node:fs';
import path from 'node:path';
import { OPENAPI_SPEC } from './openapi-spec';

function countRegisteredTools(): number {
  const file = path.join(process.cwd(), 'mcp-server.ts');
  const src = fs.readFileSync(file, 'utf-8');
  const n = (src.match(/server\.tool\('/g) ?? []).length;
  // A missing page (throw at import) is honest; serving a plausible wrong
  // number silently is not.
  if (n === 0) throw new Error(`mcp-meta: found no server.tool(' registrations in ${file}`);
  return n;
}

export const MCP_TOOL_COUNT = countRegisteredTools();

export const REST_ENDPOINT_COUNT = Object.keys(OPENAPI_SPEC.paths).length;

export interface McpToolSummary {
  name: string;
  description: string;
}

/**
 * The live tools/list answer, for /for-ai's own table. MCP_TOOL_COUNT proves
 * the NUMBER can't drift; the table of names+descriptions was still a
 * separate hand-typed array on that page (23 entries, discovered stuck there
 * while the server had grown to 44 - the same staleness class this file
 * exists to end, just one layer up). It carries only what /for-ai
 * needs (no source-attribution header, no input_schema).
 *
 * Same-box call to the sibling MCP process, so failure here means that
 * process is actually down, not a slow network - a short timeout is a
 * courtesy to the page render, not a real budget. Empty array on any failure;
 * the caller falls back to a static list rather than showing nothing.
 */
export async function listMcpTools(): Promise<McpToolSummary[]> {
  const url = process.env.MCP_URL ?? 'http://127.0.0.1:3041/mcp';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const text = await res.text();
    // The endpoint answers JSON or SSE depending on the Accept negotiation;
    // take the last "data: {...}" line if present, else the raw body.
    const line = text.split('\n').reverse().find(l => l.trim().startsWith('data:') || l.trim().startsWith('{'));
    const raw = line?.trim().startsWith('data:') ? line.trim().slice(5).trim() : (line ?? text);
    const parsed = JSON.parse(raw) as { result?: { tools?: { name: string; description?: string }[] } };
    const tools = parsed.result?.tools ?? [];
    return tools.map(t2 => ({ name: t2.name, description: t2.description ?? '' }));
  } catch {
    return [];
  }
}

/** A full MCP tool description trimmed to its first sentence, for a compact
 *  table - the live descriptions are paragraph-length, written for a model
 *  choosing between tools, not for a human skimming a page. */
export function shortDesc(d: string): string {
  const first = d.split(/\.\s/)[0].trim();
  return first.length > 120 ? first.slice(0, 117).trimEnd() + '…' : first;
}
