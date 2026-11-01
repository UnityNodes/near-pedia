/**
 * Talking to a throwaway MCP server built from a copy of the live database.
 *
 * WHY IT IS SHARED. Any check that needs to see how a real request behaves
 * against the running tool registry - not just what the schema declares -
 * grows this same shape: snapshot the database, spawn a second server
 * against it, poll for readiness, speak JSON-RPC, pull tokens out of an
 * answer, learn what a refusal looks like. A second copy of "what does a
 * refusal look like" is how two checks come to disagree about whether a
 * tool answered.
 *
 * Nothing here touches prod: the copy is a VACUUM INTO into a temp
 * directory, the server runs on its own port with the rate limiter opened
 * up, and the whole process group is killed on exit.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import Database from 'better-sqlite3';
import { repoPath } from './repo-root';

export interface ScratchMcp {
  port: number;
  /** The database the scratch server is serving, open read-only. */
  snapshot: Database.Database;
  /** Raw JSON-RPC. */
  rpc(method: string, params: unknown): Promise<Record<string, unknown>>;
  /** A tool's text answer, or ` rpc-error: ...` when the protocol rejected it. */
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  close(): void;
}

export interface StartOptions {
  /** Appears in clientInfo, and in the temp directory name. */
  label: string;
  /** Per-call timeout. Default 30s. */
  callTimeoutMs?: number;
  /** How long to wait for the server to answer /health. Default 60s. */
  readyTimeoutMs?: number;
  /** DB to snapshot. Default: the live prod DB. Lets an A/B eval run over a
   *  migrated copy without touching prod; existing callers omit it. */
  sourceDb?: string;
}

/**
 * A run killed before close() leaves its temp directory (and a full DB copy)
 * behind. Each start sweeps its own label's leftovers older than a day - no
 * live run lasts that long, and sweeping only OUR prefix keeps this from
 * touching anything else.
 */
function sweepStaleWorkDirs(label: string): void {
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  let cleaned = 0;
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith(`${label}-`)) continue;
      const full = path.join(os.tmpdir(), name);
      try {
        const st = fs.statSync(full);
        if (!st.isDirectory() || st.mtimeMs > dayAgo) continue;
        fs.rmSync(full, { recursive: true, force: true });
        cleaned++;
      } catch { /* another process may be racing us; leave it */ }
    }
  } catch { /* unreadable tmpdir: nothing to do */ }
  if (cleaned) console.warn(`[mcp-probe] swept ${cleaned} stale ${label}-* work dir(s) from a previous crashed run`);
}

export async function startScratchMcp(opts: StartOptions): Promise<ScratchMcp> {
  const callTimeoutMs = opts.callTimeoutMs ?? 30_000;
  sweepStaleWorkDirs(opts.label);
  // Derived from the pid so two checks running at once do not collide, and
  // well clear of 3130/3131.
  const port = 38000 + (process.pid % 900);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), `${opts.label}-`));
  const copy = path.join(work, 'audit.db');
  // DB_PATH matches the override lib/db.ts already honors for the Next/MCP
  // app - lets this run against a worktree checkout, which has no data/ of
  // its own, without a symlink (see worktree-data-symlink-hazard: a
  // symlinked data/ has previously replaced the live DB with a broken link).
  const src = new Database(opts.sourceDb ?? process.env.DB_PATH ?? repoPath('data', 'cips.db'), { readonly: true });
  try {
    src.prepare('VACUUM INTO ?').run(copy);
  } finally {
    src.close();
  }
  const snapshot = new Database(copy, { readonly: true });

  // Detached, stdio ignored, killed as a group: an npx-forked grandchild
  // holding the stdio pipes is the classic way to leak an MCP server per run.
  const child: ChildProcess = spawn('npx', ['tsx', 'mcp-server.ts'], {
    cwd: repoPath(),
    env: { ...process.env, DB_PATH: copy, MCP_PORT: String(port), MCP_RATE_LIMIT_MAX: '20000', MCP_TOOLSET: 'full' },
    stdio: 'ignore',
    detached: true,
  });
  const killGroup = () => { try { process.kill(-(child.pid as number), 'SIGTERM'); } catch { /* gone */ } };
  process.on('exit', killGroup);

  const until = Date.now() + (opts.readyTimeoutMs ?? 60_000);
  for (;;) {
    if (child.exitCode !== null) { killGroup(); throw new Error(`scratch server exited early (code ${child.exitCode})`); }
    try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) break; } catch { /* not up */ }
    if (Date.now() >= until) { killGroup(); throw new Error('scratch server did not become ready'); }
    await new Promise(r => setTimeout(r, 700));
  }

  let rpcId = 1;
  const rpc = async (method: string, params: unknown): Promise<Record<string, unknown>> => {
    const r = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
      signal: AbortSignal.timeout(callTimeoutMs),
    });
    const t = await r.text();
    const line = t.split('\n').find(l => l.startsWith('data: ')) ?? t;
    try { return JSON.parse(line.replace(/^data: /, '')); } catch { return { parseError: t.slice(0, 200) }; }
  };

  const callTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const res = await rpc('tools/call', { name, arguments: args });
    // A protocol-level rejection has no content, and reading it as an empty
    // answer would make every wrongly-typed call look like a refusal from
    // the tool itself.
    const err = (res as { error?: { message?: string } }).error;
    if (err) return ` rpc-error: ${err.message ?? ''}`;
    const content = (res as { result?: { content?: { text?: string }[] } }).result?.content ?? [];
    return content.map(c => c.text ?? '').join('\n');
  };

  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: opts.label, version: '1' },
  });

  return {
    port,
    snapshot,
    rpc,
    callTool,
    close() {
      try { snapshot.close(); } catch { /* already shut */ }
      killGroup();
      try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* leave it */ }
    },
  };
}

/**
 * Candidate identifiers in a tool's output.
 *
 * Deliberately generous: anything that survives markdown punctuation and is
 * long enough to be an id. Being generous is what makes this an honest test
 * of the PRODUCER rather than of a regex someone wrote to match the current
 * format - if any token at all works, the pair is usable.
 *
 * The trailing ellipsis is kept as its own variant rather than only
 * stripped, because `00a2a1fb5745c951…` is literally what a caller pastes.
 */
export function tokens(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split(/[\s,;|()[\]{}<>"']+/)) {
    const t = raw.replace(/^[`*_#•·⟪-]+|[`*_#⟪⟫.:·]+$/gu, '');
    if (t.length < 3 || t.length > 200) continue;
    out.add(t);
    const noEllipsis = t.replace(/[…]+$/u, '');
    if (noEllipsis !== t && noEllipsis.length >= 3) out.add(noEllipsis);
    // A URL usually carries the id in its last segment or its v= parameter.
    const tail = t.split(/[/?=]/).filter(Boolean).pop();
    if (tail && tail.length >= 3) out.add(tail);
  }
  return [...out];
}

export interface Refusal { prefix: string; suffix: string; exact: string | null }

/**
 * The fixed part of a tool's refusal, learned from two different impossible
 * values.
 *
 * These tools quote the rejected id back, so two refusals differ exactly
 * where the value sits and agree everywhere else. The common prefix and
 * suffix are that template.
 *
 * The obvious alternative - take one refusal and delete the value from it
 * before comparing - is wrong and produces false passes. Deleting a token
 * that also appears in the surrounding prose deletes it from the prose too,
 * so the strings stop matching and garbage reads as accepted.
 *
 * THE TWO VALUES MUST DIFFER AT BOTH ENDS and share no substring, because
 * anything they have in common is swallowed into the template. A consumer
 * that truncates its echo can also make two different values produce one
 * identical refusal, which is why `exact` exists.
 */
export function learnRefusal(a: string, b: string): Refusal {
  if (a === b) return { prefix: '', suffix: '', exact: a };
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return { prefix: a.slice(0, i), suffix: a.slice(a.length - j), exact: null };
}

export function looksLikeRefusal(answer: string, r: Refusal): boolean {
  if (r.exact !== null) return answer === r.exact;
  if (!r.prefix && !r.suffix) return false;
  return answer.startsWith(r.prefix) && answer.endsWith(r.suffix);
}

/** Two impossible values that share nothing, so the learned template is real. */
export const IMPOSSIBLE_A = 'zzqaaa11111111';
export const IMPOSSIBLE_B = 'qqzbbb22222222';
if (IMPOSSIBLE_A[0] === IMPOSSIBLE_B[0] || IMPOSSIBLE_A.at(-1) === IMPOSSIBLE_B.at(-1)) {
  throw new Error('the two negative-control values must differ at both ends, or the learned refusal template swallows part of the value');
}
