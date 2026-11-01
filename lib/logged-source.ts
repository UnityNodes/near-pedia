/**
 * The name a script records itself under in sync_log, read from its own source.
 *
 * THERE ARE TWO MECHANISMS, and assuming one misses the other: logRun() is
 * the explicit call; guardSync() wraps a whole entry point and writes the row
 * itself. A script using only guardSync() would read as unmonitorable to
 * anything that only looks for logRun().
 *
 * The name is also not derivable from the filename in general — a script can
 * pass a constant rather than a literal, or log under a name that doesn't
 * match its own basename. This reads the argument rather than guessing it.
 *
 * IT LIVES IN lib/ because two callers need it: a check that asks whether
 * every writer still completes, and anything that files a crash under the
 * name that check will look for. If the two ever disagreed about where a
 * script logs, one would write rows nobody reads and the other would go on
 * seeing silence.
 */

import fs from 'node:fs';
import { repoPath } from './repo-root';

/**
 * Returns the sync_log source for a script basename, or null when the script
 * registers no name at all. A trailing `%` means the script logs one row per
 * item under that prefix, and the caller should match with LIKE.
 */
export function loggedSourceOf(script: string): string | null {
  let src: string;
  try {
    src = fs.readFileSync(repoPath('scripts', `${script}.ts`), 'utf8');
  } catch { return null; }

  // guardSync FIRST: a file that declares its own local helper also called
  // logRun (taking a different first argument) would otherwise be misread.
  const order = /function\s+logRun\s*\(/.test(src) ? ['guardSync'] : ['guardSync', 'logRun'];

  for (const fn of order) {
    const literal = src.match(new RegExp(`${fn}\\(\\s*'([^']+)'`));
    if (literal) return literal[1];

    // fn(`prefix-${...}`, ...) - one row per group rather than one per script.
    const tpl = src.match(new RegExp(`${fn}\\(\\s*\`([a-z0-9-]+-)\\$\\{`));
    if (tpl) return `${tpl[1]}%`;

    // fn(SOURCE, ...) - resolve the constant in the same file.
    const viaConst = src.match(new RegExp(`${fn}\\(\\s*([A-Za-z_$][\\w$]*)\\s*,`));
    if (viaConst) {
      const decl = src.match(new RegExp(`\\b(?:const|let)\\s+${viaConst[1]}\\s*(?::[^=]+)?=\\s*'([^']+)'`));
      if (decl) return decl[1];
    }
  }
  return null;
}
