import fs from 'node:fs';
import path from 'node:path';
import { isChecked } from '../github-action/lib.mjs';

const SKIP_DIR = /^(node_modules|target|dist|build|out|vendor|\.next|coverage|\.git)$/;
const MAX_BYTES = 2_000_000;

export function listCodeFiles(base: string, dir = base, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIR.test(e.name)) listCodeFiles(base, full, out);
    } else if (e.isFile()) {
      const rel = path.relative(base, full).split(path.sep).join('/');
      if (isChecked(rel) && fs.statSync(full).size < MAX_BYTES) out.push(rel);
    }
  }
  return out.sort();
}
