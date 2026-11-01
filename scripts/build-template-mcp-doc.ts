#!/usr/bin/env node
/**
 * Writes docs/template/mcp-api.md: the inventory of every MCP tool, MCP resource
 * and REST route this server offers, for someone deciding what to keep, adapt or
 * remove when they reskin the template for another ecosystem.
 *
 * WHY IT IS GENERATED. A hand-written inventory drifts: one such document
 * listed 33 tools for a server that registered 90, with line numbers into a
 * file a third the size, and nothing noticed. A hand-written copy rewritten
 * against the live file matches only until the next tool is added. A document that has to be re-typed by whoever adds a tool is
 * wrong the first time somebody forgets, and nothing tells them they have. So the mechanical part is read
 * from the sources of truth and the prose that needs judgement (which group of
 * tools is worth keeping) lives in this file next to the tool-to-group map.
 *
 * SOURCES.
 *   tool names, descriptions, inputs   a live tools/list against MCP_URL
 *   tables a tool reads                 FROM/JOIN names inside its registration in
 *                                       mcp-server.ts, kept only if the table exists
 *   lib modules it delegates to         functions it calls that mcp-server.ts imports
 *   REST routes                         lib/openapi-spec.ts (OPENAPI_SPEC)
 *
 * A tool that is registered but not in GROUPS stops the run: a new tool has to be
 * classified, which is the moment somebody decides whether a reskin keeps it.
 * scripts/check-template-mcp-doc.ts fails when the file and the server disagree.
 *
 *   npx tsx scripts/build-template-mcp-doc.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { OPENAPI_SPEC } from '../lib/openapi-spec';
import { repoPath } from '../lib/repo-root';

const MCP_URL = process.env.MCP_URL ?? 'http://127.0.0.1:3041/mcp';
const OUT = process.env.DOC_OUT ?? repoPath('docs', 'template', 'mcp-api.md');

interface Tool { name: string; description: string; inputSchema?: { properties?: Record<string, unknown>; required?: string[] } }

type Verdict = 'keep' | 'adapt' | 'remove';

const GROUPS: Array<{ title: string; verdict: Verdict; why: string; tools: string[] }> = [
  {
    title: 'Core retrieval',
    verdict: 'keep',
    why: 'The engine: search over whatever corpus you index, reading a document, what changed recently, what is popular. Nothing here is YourChain-shaped except the descriptions and the corpus behind it.',
    tools: ['search', 'semantic_search', 'get_doc', 'get_recent_changes', 'get_trending', 'get_network_stats', 'get_radar'],
  },
  {
    title: 'Improvement proposals',
    verdict: 'adapt',
    why: 'Shaped around CIPs (numbered proposals with a status, history, attachments and dependencies). Keep if your ecosystem has an equivalent (EIPs, SIPs, TIPs), retarget the tables, and drop it if it has none.',
    tools: ['get_cip', 'list_cips', 'get_cip_history', 'get_cip_attachments', 'get_cip_mentions', 'detect_cip_dependency_chain', 'find_cip_for_feature'],
  },
  {
    title: 'Forum and community',
    verdict: 'adapt',
    why: 'Built on a Discourse forum. Keep if your community has one; the analysis tools (expert finding, known issues, contradictions between sources) work on any forum data with reply counts and authors.',
    tools: ['get_discussion', 'find_expert', 'find_maintainer_guidance', 'find_known_issues', 'find_code_examples', 'detect_drift'],
  },
  {
    title: 'GitHub',
    verdict: 'keep',
    why: 'Generic over any set of repositories: point the repo list at yours.',
    tools: ['list_repos', 'list_github_discussions', 'get_github_discussion', 'search_github_issues', 'get_issue_status'],
  },
  {
    title: 'Releases and errors',
    verdict: 'adapt',
    why: 'Release and changelog tools work for any repositories. Error diagnosis reads YourChain knowledge and needs your own content, or should go.',
    tools: ['get_latest_release', 'search_release_notes', 'find_security_patches', 'get_sdk_changelog', 'get_breaking_changes', 'diagnose_error'],
  },
  {
    title: 'Network state',
    verdict: 'remove',
    why: 'Live YourChain on-chain state and the TKN market, fetched in real time from Explorer. Replace with your own chain and market source or delete.',
    tools: ['get_network_state'],
  },
  {
    title: 'Ecosystem',
    verdict: 'adapt',
    why: 'A catalogue of ecosystem projects (DeFi, wallets, infrastructure, tokenized assets) and the tools that compare them. Generic in shape; the catalogue behind it is YourChain\'s.',
    tools: ['list_ecosystem_projects', 'find_similar_projects', 'ecosystem_dependency_graph', 'find_collaboration_opportunities'],
  },
  {
    title: 'Papers, talks, blog posts and foundation pages',
    verdict: 'adapt',
    why: 'Whitepapers, YouTube talks, blog posts and foundation pages are generic content types; the sources behind them are YourChain\'s.',
    tools: ['list_whitepapers', 'get_whitepaper', 'list_videos', 'get_video', 'list_blog_posts', 'get_blog_post', 'search_talks', 'get_foundation_info'],
  },
  {
    title: 'Onboarding',
    verdict: 'adapt',
    why: 'Onboarding paths for building on YourChain. Useful if you write your own, otherwise remove.',
    tools: ['get_started_guide', 'learning_path'],
  },
];

/** Library modules every handler touches, so naming them on each row says nothing. */
const IGNORED_LIBS = new Set(['lib/db', 'lib/untrusted-fence']);

function esc(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function firstSentence(text: string, max = 170): string {
  // "e.g." and "i.e." end in a full stop that is not the end of the sentence.
  // This repo's writing rule has no dashes in prose, and some tool descriptions carry them.
  const flat = text.replace(/\s+/g, ' ').trim().replace(/\s[\u2014\u2013]\s/g, ', ').replace(/\b(e\.g|i\.e|etc|vs)\./gi, m => m.replace('.', '\u0001'));
  const m = flat.match(/^(.+?[.!?])(?=\s+[A-Z(])/);
  let s = (m ? m[1] : flat).replace(/\u0001/g, '.');
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, '') + '...';
  return s;
}

async function listTools(): Promise<Tool[]> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`tools/list answered HTTP ${res.status} from ${MCP_URL}`);
  const body = await res.text();
  const line = body.split('\n').find(l => l.startsWith('data: ')) ?? body;
  const parsed = JSON.parse(line.replace(/^data: /, '')) as { result?: { tools?: Tool[] } };
  const tools = parsed.result?.tools;
  if (!tools?.length) throw new Error('tools/list returned no tools');
  return tools;
}

/** name -> the source text of its server.tool(...) registration. */
function registrationBlocks(src: string): Map<string, string> {
  const starts = [...src.matchAll(/^server\.(tool|resource)\('([^']+)'/gm)].map(m => ({ kind: m[1], name: m[2], at: m.index ?? 0 }));
  const out = new Map<string, string>();
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : src.length;
    out.set(`${s.kind}:${s.name}`, src.slice(s.at, end));
  });
  return out;
}

/** imported identifier -> lib module (without extension) */
function importMap(src: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+'\.\/(lib\/[A-Za-z0-9_\-]+)(?:\.js)?'/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) map.set(name, m[2]);
    }
  }
  return map;
}

function realTables(): Set<string> {
  const dbPath = process.env.DB_PATH ?? repoPath('data', 'cips.db');
  const db = new Database(dbPath, { readonly: true });
  try {
    return new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','view')`).all() as { name: string }[]).map(r => r.name));
  } finally {
    db.close();
  }
}

function tablesIn(block: string, tables: Set<string>): string[] {
  const found = new Set<string>();
  for (const m of block.matchAll(/\b(?:FROM|JOIN)\s+"?([a-z_][a-z0-9_]*)"?/gi)) {
    if (tables.has(m[1])) found.add(m[1]);
  }
  return [...found].sort();
}

function libsIn(block: string, imports: Map<string, string>): string[] {
  const found = new Set<string>();
  for (const m of block.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\(/g)) {
    const lib = imports.get(m[1]);
    if (lib && !IGNORED_LIBS.has(lib)) found.add(lib);
  }
  return [...found].sort();
}

function inputs(t: Tool): string {
  const props = Object.keys(t.inputSchema?.properties ?? {});
  const req = new Set(t.inputSchema?.required ?? []);
  return props.length ? props.map(p => `\`${p}\`${req.has(p) ? '*' : ''}`).join(', ') : 'none';
}

function needs(block: string): string {
  const parts: string[] = [];
  if (/\bembedText\(/.test(block)) parts.push('OPENAI_API_KEY');
  if (/\brerank\(/.test(block)) parts.push('CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN, or COHERE_API_KEY (optional)');
  return parts.join(', ');
}

async function main(): Promise<void> {
  const tools = await listTools();
  const byName = new Map(tools.map(t => [t.name, t]));
  const src = fs.readFileSync(repoPath('mcp-server.ts'), 'utf-8');
  const blocks = registrationBlocks(src);
  const imports = importMap(src);
  const tables = realTables();

  const assigned = new Map<string, string>();
  for (const g of GROUPS) for (const t of g.tools) {
    if (assigned.has(t)) throw new Error(`build-template-mcp-doc: ${t} is in two groups (${assigned.get(t)} and ${g.title})`);
    assigned.set(t, g.title);
  }
  const unassigned = tools.map(t => t.name).filter(n => !assigned.has(n)).sort();
  if (unassigned.length) {
    throw new Error(`build-template-mcp-doc: registered but not in GROUPS, classify them first: ${unassigned.join(', ')}`);
  }
  const gone = [...assigned.keys()].filter(n => !byName.has(n)).sort();
  if (gone.length) throw new Error(`build-template-mcp-doc: in GROUPS but not registered: ${gone.join(', ')}`);

  const keys = tools.filter(t => needs(blocks.get(`tool:${t.name}`) ?? '')).map(t => t.name).sort();

  const L: string[] = [];
  const p = (s = '') => L.push(s);

  p('# MCP server and REST API reference');
  p();
  p('> Generated by `scripts/build-template-mcp-doc.ts` from the running server (`tools/list`), `mcp-server.ts` and `lib/openapi-spec.ts`. Edit the generator, not this file: the next run overwrites it, and `scripts/check-template-mcp-doc.ts` fails when the two disagree.');
  p();
  p('## What this server is');
  p();
  p('`mcp-server.ts` is one Express application that serves two interfaces from one process, over one SQLite file:');
  p();
  const resourceCount = [...blocks.keys()].filter(k => k.startsWith('resource:')).length;
  p(`- **MCP** at \`/mcp\` (POST and GET), ${tools.length} tools${resourceCount ? ` and ${resourceCount} resources` : ''}. It is stateless: every request builds a fresh server and a fresh \`StreamableHTTPServerTransport\` with no session id, so any caller can hit any instance.`);
  p(`- **REST** under \`/api/v1\`, plus \`/health\`: ${Object.keys(OPENAPI_SPEC.paths).length} documented operations. \`lib/openapi-spec.ts\` (\`OPENAPI_SPEC\`) is the source of truth for \`/api/v1/openapi.json\` and the interactive reference at \`/api/v1/reference\`; add or remove a route without touching it and the published docs drift.`);
  p();
  p('It is a separate process from the Next.js site (`yourpedia-mcp.service` next to `yourpedia.service`, port 3041 by default, bound to 127.0.0.1). The reverse proxy sends `/mcp*` and `/api/v1*` to it and everything else to Next. The Next port serves exactly one `/api/v1` route of its own (`sources`), so any other `/api/v1` path answers 404 there. The site asks this process for its tool count through `lib/mcp-meta.ts` (`MCP_URL`, default `http://127.0.0.1:3041/mcp`).');
  p();
  p('The data connection is opened read-only. A second, writable handle exists for one purpose: recording MCP usage in `mcp_calls`. A failure there is swallowed and never reaches the caller.');
  p();
  p('### Behaviour every route shares');
  p();
  p('- **Rate limits per caller:** `/mcp` 60 requests per 15 minutes (`MCP_RATE_LIMIT_MAX` raises it on a scratch instance), `/api/v1` 120 per 15 minutes, `/api/v1/search` 20 per minute. The limits are constants in `mcp-server.ts`, not configuration. `trust proxy` is `loopback`, so the caller is read from `X-Forwarded-For` only when the request came from this host.');
  p('- **REST headers:** `Access-Control-Allow-Origin: *` and `Cache-Control: public, s-maxage=300, stale-while-revalidate=1800` on everything under `/api`. Data changes on the sync schedule, minutes to hours apart, so five-minute-old answers are fine.');
  p('- **Untrusted text is fenced.** Any tool that returns text written by outsiders (forum posts, GitHub issues, PR titles) wraps it with `lib/untrusted-fence.ts` so an instruction planted in a post is data to the model, not a command. A new tool that returns such text must do the same.');
  p('- **Counts are derived, not typed.** `MCP_TOOLS_COUNT` in `mcp-server.ts` counts the registrations, `/api/v1/sources` and `/health` publish it, and `lib/mcp-meta.ts` reads it back for the site. Do not write the number anywhere by hand.');
  p();
  p('### What needs an API key');
  p();
  p(`Almost nothing. The database file is enough to serve every REST route and every tool except ${keys.length ? keys.map(k => `\`${k}\``).join(', ') : 'none'}, which embeds the query and therefore needs \`OPENAI_API_KEY\` (\`lib/embeddings.ts\`, the \`text-embedding-3-small\` model). \`COHERE_API_KEY\` improves its ranking through \`lib/reranker.ts\` and is optional: without it the reranker logs a skip and the boost-only order is used. Remove that one tool and the server needs no keys at all.`);
  p();

  p('## What to keep, adapt or remove');
  p();
  p('| Group | Tools | Verdict | Why |');
  p('|---|---|---|---|');
  for (const g of GROUPS) p(`| ${g.title} | ${g.tools.length} | **${g.verdict}** | ${esc(g.why)} |`);
  p();
  const counts = { keep: 0, adapt: 0, remove: 0 } as Record<Verdict, number>;
  for (const g of GROUPS) counts[g.verdict] += g.tools.length;
  p(`That is ${counts.keep} tools to keep as they are, ${counts.adapt} to adapt and ${counts.remove} that only make sense for YourChain. Every description names YourChain and its sources: rewrite them (see \`docs/template/mcp-tool-descriptions.md\`), because a model chooses a tool from its description alone.`);
  p();

  p('## MCP tools');
  p();
  p('`*` marks a required input. **Reads** lists the tables the handler queries itself. **Also uses** lists the `lib/` modules whose functions it calls, which is where the rest of the SQL lives.');
  p();
  for (const g of GROUPS) {
    p(`### ${g.title} (${g.tools.length}, ${g.verdict})`);
    p();
    p('| Tool | What it does | Input | Reads | Also uses |');
    p('|---|---|---|---|---|');
    for (const name of g.tools) {
      const t = byName.get(name)!;
      const b = blocks.get(`tool:${name}`) ?? '';
      const reads = tablesIn(b, tables).map(x => `\`${x}\``).join(', ') || 'none directly';
      const uses = libsIn(b, imports).map(x => `\`${x}\``).join(', ') || 'none';
      p(`| \`${name}\` | ${esc(firstSentence(t.description))} | ${inputs(t)} | ${reads} | ${uses} |`);
    }
    p();
  }

  const resources = [...blocks.entries()].filter(([k]) => k.startsWith('resource:'));
  if (resources.length) {
    p(`## MCP resources (${resources.length})`);
    p();
    p('Static documents an MCP client can load without calling a tool.');
    p();
    p('| Resource | URI | Backed by |');
    p('|---|---|---|');
    for (const [k, b] of resources) {
      const name = k.slice('resource:'.length);
      const uri = b.match(/^server\.resource\('[^']+',\s*'([^']+)'/)?.[1] ?? '';
      const cat = b.match(/fkbCategoryJson\('([A-Z_]+)'\)/)?.[1];
      const reads = cat ? `\`foundation_kb\`, category ${cat}` : (tablesIn(b, tables).map(x => `\`${x}\``).join(', ') || 'computed');
      p(`| \`${name}\` | \`${uri}\` | ${reads} |`);
    }
    p();
  }

  p('## REST routes');
  p();
  p(`From \`lib/openapi-spec.ts\`: ${Object.keys(OPENAPI_SPEC.paths).length} operations. Handlers are the \`app.get\` and \`app.post\` calls in \`mcp-server.ts\`.`);
  p();
  type Op = { tags?: string[]; summary?: string };
  const byTag = new Map<string, Array<{ method: string; route: string; summary: string }>>();
  for (const [route, ops] of Object.entries(OPENAPI_SPEC.paths as unknown as Record<string, Record<string, Op>>)) {
    for (const [method, op] of Object.entries(ops)) {
      if (!['get', 'post', 'put', 'delete'].includes(method)) continue;
      const tag = op.tags?.[0] ?? 'Other';
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push({ method: method.toUpperCase(), route, summary: op.summary ?? '' });
    }
  }
  for (const [tag, ops] of [...byTag.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    p(`### ${tag} (${ops.length})`);
    p();
    p('| Method | Route | What it returns |');
    p('|---|---|---|');
    for (const o of ops) p(`| ${o.method} | \`${o.route}\` | ${esc(o.summary)} |`);
    p();
  }

  p('## Reskin checklist for this server');
  p();
  p('1. **Decide the groups.** Delete the registrations of every group marked *remove* and the ones you will not port. Each tool is a `server.tool(...)` call inside `createServer()`. After deleting one, search for its name: the OpenAPI spec, the argument aliases in `mcp-server.ts`, the docs and several checks under `scripts/` also name tools.');
  p('2. **Retarget what you keep.** Change the tables and libraries in the **Reads** and **Also uses** columns. The repository list in `scripts/sync-github-releases.ts` (`REPOS`) drives the release tools and `list_repos`.');
  p('3. **Rewrite the descriptions.** Every one names YourChain. `docs/template/mcp-tool-descriptions.md` explains how to write them so the right tool is picked when a user has several MCP servers connected.');
  p('4. **Rename the brand.** The name and site URL appear in tool output. `grep -n "yourpedia\\|YOURPEDIA" mcp-server.ts` lists them; the site URL should come from `SITE.url` in `lib/site.config.ts`.');
  p('5. **Keep the spec in step.** Update `lib/openapi-spec.ts` for every route you add or remove.');
  p('6. **Regenerate this file** (below) and the docs site, if you run one.');
  p();
  p('## Regenerating');
  p();
  p('```bash');
  p('npx tsx scripts/build-template-mcp-doc.ts        # needs the MCP process running: it reads tools/list');
  p('npx tsx scripts/check-template-mcp-doc.ts        # fails if this file and the server disagree');
  p('```');
  p();
  p('`MCP_URL` points the generator at another instance, and `DOC_OUT` writes somewhere else. Adding a tool without listing it in `GROUPS` at the top of the generator stops the run, so the new tool is classified at the moment it is added.');
  p();

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, L.join('\n'));
  console.log(`[build-template-mcp-doc] ${tools.length} tools, ${resources.length} resources, ${[...byTag.values()].reduce((n, o) => n + o.length, 0)} REST operations -> ${OUT}`);
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
