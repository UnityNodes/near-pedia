import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../lib/db';
import { checkCode } from '../lib/check-code';
import { clip, isChecked } from '../github-action/lib.mjs';

const STALE = new Set(['deprecated', 'removed', 'changed']);
const STATS_SKIP = new Set(['view-access-key-list-unpaginated', 'experimental-tx-status']);
const SKIP_DIR = /^(node_modules|target|dist|build|out|vendor|\.next|coverage|\.git)$/;
const NOT_CODE_PATH = /(^|\/)(tests?|__tests__|fixtures?|mocks?|examples?|docs?)\/|\.(test|spec)\.[a-z]+$/i;
const COMMENT = /^(\/\/|\/\*|\*|#(?!\[)|<!--)/;
const MAX_BYTES = 2_000_000;

function files(base: string, dir = base, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIR.test(e.name)) files(base, full, out);
    } else if (e.isFile()) {
      const rel = path.relative(base, full);
      if (isChecked(rel) && !NOT_CODE_PATH.test(rel) && fs.statSync(full).size < MAX_BYTES) out.push(rel);
    }
  }
  return out;
}

function staleIn(db: ReturnType<typeof getDb>, base: string): Map<string, number> {
  const hits = new Map<string, number>();
  for (const rel of files(base)) {
    const text = fs.readFileSync(path.join(base, rel), 'utf8');
    const { code } = clip(text);
    if (!code.trim()) continue;
    const lines = code.split('\n');
    for (const f of checkCode(db, code, { filename: rel }).findings) {
      const e = f.entry;
      if (!e || e.strength !== 'strong' || !STALE.has(e.status) || STATS_SKIP.has(e.id)) continue;
      if (!/\.(toml|json)$/.test(rel) && COMMENT.test((lines[f.line - 1] ?? '').trim())) continue;
      hits.set(e.id, (hits.get(e.id) ?? 0) + 1);
    }
  }
  return hits;
}

function main() {
  const root = process.argv[2];
  if (!root || !fs.existsSync(root)) throw new Error('usage: count-stale-repos.ts <directory of clones> [--names]');
  const names = process.argv.includes('--names');
  const db = getDb();
  const repos = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const byEntry = new Map<string, number>();
  const stale: string[] = [];
  for (const repo of repos) {
    const hits = staleIn(db, path.join(root, repo));
    if (hits.size === 0) continue;
    stale.push(repo);
    for (const id of hits.keys()) byEntry.set(id, (byEntry.get(id) ?? 0) + 1);
  }
  const basis = db.prepare('SELECT COUNT(*) AS n, MAX(built_at) AS at FROM deprecations').get() as { n: number; at: string | null };
  console.log(JSON.stringify({
    repositories: repos.length,
    with_stale_code: stale.length,
    projects_per_entry: Object.fromEntries([...byEntry].sort((a, b) => b[1] - a[1])),
    index: { entries: basis.n, built_at: basis.at },
    ...(names ? { stale } : {}),
  }, null, 2));
}

main();
