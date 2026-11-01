/**
 * What a request can actually reach, by walking imports rather than guessing
 * from a path.
 *
 * WHY. Two checks ask this question and should answer it the same way.
 * check-deadlines walks the import graph out from the entry points to know
 * what a request touches; check-deployed asks what Next actually compiles,
 * to know whether a changed file owes a rebuild. Guessing from a path prefix
 * instead of walking imports is wrong in the direction that costs trust: a
 * lib/ file imported only by check scripts, and never by anything the site
 * serves, is not something Next bundles, so a build isn't owed for it - a
 * prefix-based guess would call that STALE BUILD for a difference that
 * doesn't exist. A check that's red for a reason nobody can act on is a
 * check people learn to skip.
 *
 * The walk is shared and the ENTRY SET is the parameter, because that is the
 * only part the two callers disagree about: check-deadlines cares about what
 * a request touches (API routes and the MCP server), check-deployed about
 * what Next compiles (every page, layout and route, plus middleware).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripJsComments } from './strip-comments';

/**
 * Directories to skip, matched at the REPO ROOT only.
 *
 * Matching on the directory name anywhere in the tree looks equivalent and
 * is not: a route handler whose parent directory happens to share a skipped
 * name would never be seen by the walk if the name were matched at any
 * depth.
 */
const SKIP_ROOT_DIRS = new Set(['node_modules', '.next', '.next.new', '.next.prev', '.git', 'data', 'public', 'tests']);

/** Every .ts/.tsx file in the tree, as absolute paths. */
export function sourceFiles(root: string): string[] {
  const out: string[] = [];
  (function rec(dir: string, depth: number) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (depth === 0 && SKIP_ROOT_DIRS.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) rec(p, depth + 1);
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
  })(root, 0);
  return out;
}

/** `@/x` and `./x` to a file on disk. Bare specifiers are packages: not ours. */
export function resolveImport(spec: string, from: string, root: string): string | null {
  // ESM specifiers name the EMITTED file: mcp-server.ts imports './lib/search.js'
  // and the source is lib/search.ts. Without stripping the extension the walk
  // resolves nothing out of mcp-server.ts at all - it reaches exactly one
  // module, itself.
  const bare = spec.replace(/\.(js|jsx|mjs|cjs)$/, '');
  let base: string;
  if (bare.startsWith('@/')) base = join(root, bare.slice(2));
  else if (bare.startsWith('.')) base = join(from, '..', bare);
  else return null;
  for (const s of ['.ts', '.tsx', '', '/index.ts', '/index.tsx']) {
    const c = base + s;
    try { if (statSync(c).isFile()) return c; } catch { /* try the next extension */ }
  }
  return null;
}

/**
 * Everything reachable from `entries`, as absolute paths, entries included.
 *
 * Both static `from '...'` and dynamic `import('...')` are followed. Missing
 * the dynamic form would make a lazily-loaded module look unreachable.
 */
export function reachableFrom(entries: string[], root: string): Set<string> {
  const reachable = new Set<string>();
  const queue = [...entries];
  while (queue.length) {
    const f = queue.pop()!;
    if (reachable.has(f)) continue;
    reachable.add(f);
    let src: string;
    try { src = stripJsComments(readFileSync(f, 'utf8')); } catch { continue; }
    for (const re of [/from\s+['"]([^'"]+)['"]/g, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g]) {
      for (const m of src.matchAll(re)) {
        const r = resolveImport(m[1], f, root);
        if (r && !reachable.has(r)) queue.push(r);
      }
    }
  }
  return reachable;
}

/** What a request touches: API routes and the MCP server. */
export function isRequestEntry(rel: string): boolean {
  return rel === 'mcp-server.ts' || (rel.startsWith('app/') && /\/route\.tsx?$/.test(rel));
}

/**
 * What Next compiles into a build.
 *
 * Wider than the request set on purpose: a page, a layout, an OG image and
 * the middleware are all entry points to the bundle even though none of
 * them is an API route.
 */
export function isNextEntry(rel: string): boolean {
  if (rel === 'middleware.ts' || rel === 'next.config.ts' || rel === 'instrumentation.ts') return true;
  if (!rel.startsWith('app/')) return false;
  return /(^|\/)(page|layout|template|loading|error|global-error|not-found|route|default|sitemap|robots|manifest|opengraph-image|twitter-image|icon|apple-icon)\.tsx?$/.test(rel);
}
