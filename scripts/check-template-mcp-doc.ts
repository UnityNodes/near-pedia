/**
 * Does docs/template/mcp-api.md still describe the server that runs?
 *
 * The hand-written version of that file listed 33 tools while the server
 * registered 90 and nothing noticed, because nothing compared them. The file is
 * generated now (scripts/build-template-mcp-doc.ts), but a generated file is only
 * as fresh as the last time somebody ran the generator, and adding a tool does not
 * make anyone run it. This compares the two sides and fails when they differ:
 *
 *   tools       server.tool('name' registrations in mcp-server.ts  vs  the tool tables
 *   resources   server.resource('name' registrations              vs  the resource table
 *   routes      OPENAPI_SPEC method + path                         vs  the route tables
 *
 * The sides are independent: the registered set comes from source and the spec, the
 * documented set from the markdown. It does not need the MCP process to be running,
 * unlike the generator.
 *
 * Fix a failure with: npx tsx scripts/build-template-mcp-doc.ts
 *
 *   npx tsx scripts/check-template-mcp-doc.ts
 */
import fs from 'node:fs';
import { OPENAPI_SPEC } from '../lib/openapi-spec';
import { logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { repoPath } from '../lib/repo-root';

const DOC = repoPath('docs', 'template', 'mcp-api.md');

function section(md: string, heading: string): string {
  const start = md.indexOf(`\n## ${heading}`);
  if (start < 0) return '';
  const next = md.indexOf('\n## ', start + 4);
  return md.slice(start, next < 0 ? md.length : next);
}

function diff(label: string, registered: Set<string>, documented: Set<string>, problems: string[]): void {
  for (const n of [...registered].sort()) if (!documented.has(n)) problems.push(`[undocumented ${label}] ${n}`);
  for (const n of [...documented].sort()) if (!registered.has(n)) problems.push(`[ghost ${label}] ${n}: documented but not on the server`);
}

function main(): void {
  if (!fs.existsSync(DOC)) throw new Error(`${DOC} does not exist; run scripts/build-template-mcp-doc.ts`);
  const md = fs.readFileSync(DOC, 'utf-8');
  const src = fs.readFileSync(repoPath('mcp-server.ts'), 'utf-8');

  const tools = new Set([...src.matchAll(/^server\.tool\('([a-z][a-z0-9_]+)'/gm)].map(m => m[1]));
  const resources = new Set([...src.matchAll(/^server\.resource\('([^']+)'/gm)].map(m => m[1]));
  const routes = new Set<string>();
  for (const [route, ops] of Object.entries(OPENAPI_SPEC.paths as unknown as Record<string, Record<string, unknown>>)) {
    for (const method of Object.keys(ops)) if (['get', 'post', 'put', 'delete'].includes(method)) routes.add(`${method.toUpperCase()} ${route}`);
  }
  if (!tools.size || !routes.size) throw new Error('found no tools or routes on the server side; the parse is broken');

  const docTools = new Set([...section(md, 'MCP tools').matchAll(/^\| `([a-z][a-z0-9_]+)` \|/gm)].map(m => m[1]));
  const docResources = new Set([...section(md, 'MCP resources').matchAll(/^\| `([^`]+)` \| `[^`]+:\/\//gm)].map(m => m[1]));
  const docRoutes = new Set([...section(md, 'REST routes').matchAll(/^\| (GET|POST|PUT|DELETE) \| `([^`]+)` \|/gm)].map(m => `${m[1]} ${m[2]}`));

  const problems: string[] = [];
  diff('tool', tools, docTools, problems);
  diff('resource', resources, docResources, problems);
  diff('route', routes, docRoutes, problems);

  for (const p of problems) console.error(`  ${p}`);
  console.log(
    problems.length
      ? `[check-template-mcp-doc] ${problems.length} difference(s) between docs/template/mcp-api.md and the server; run scripts/build-template-mcp-doc.ts`
      : `[check-template-mcp-doc] ${tools.size} tools, ${resources.size} resources and ${routes.size} routes all match docs/template/mcp-api.md`,
  );
  logRun('check-template-mcp-doc', {
    status: problems.length ? 'error' : 'success',
    items: tools.size + resources.size + routes.size,
    error: problems.length ? problems.slice(0, 3).join(' | ').slice(0, 1000) : undefined,
  });
  if (problems.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error('check-template-mcp-doc failed:', err);
    logRun('check-template-mcp-doc', { status: 'error', items: 0, error: String(err).slice(0, 1000) });
    process.exit(1);
  }
}
