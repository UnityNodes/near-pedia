import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The root of this repository, resolved from this module's own location.
 *
 * Anything a script writes must be addressed relative to the project it
 * belongs to, not to the directory it happened to be launched from — a
 * cwd-relative path makes a script's identity depend on the caller, and this
 * box runs several sibling repos side by side.
 *
 * Matches on package.json name so a nested package.json cannot be mistaken for
 * the root. Falls back to cwd only where import.meta is unavailable, which is
 * the bundled server, and there the process manager sets WorkingDirectory.
 */
const PACKAGE_NAME = 'yourpedia';

let cached: string | null = null;

export function repoRoot(): string {
  if (cached) return cached;

  let dir: string;
  try {
    dir = path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return (cached = process.cwd());
  }

  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: string };
      if (pkg.name === PACKAGE_NAME) return (cached = dir);
    } catch { /* no package.json here, keep walking up */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return (cached = process.cwd());
}

/** Path inside this repository, regardless of where the process was started. */
export function repoPath(...segments: string[]): string {
  return path.join(repoRoot(), ...segments);
}
