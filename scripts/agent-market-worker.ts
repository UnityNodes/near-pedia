import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { nearAiConfig } from '../lib/near-ai';
import { MIGRATION_GUIDE_URL, migrateRepo, renderReport, repoFrom, type RepoRef } from '../lib/migrate-repo';
import { REPORT_FILE, confirmMessage, fitDeliverable, nextStep, withChanges, type AssignmentRow } from '../lib/agent-market';

const BASE = (process.env.MARKET_BASE_URL ?? 'https://market.near.ai').replace(/\/+$/, '');
const TOKEN = process.env.AGENT_API_TOKEN ?? '';
const POLL_MS = 45_000;
const MAX_TRIES = 3;
const RETRY_AFTER_MS = 5 * 60_000;
const PATCH_NAME = 'nearpedia-migration.patch';
const WORK_ROOT = process.env.AGENT_WORKDIR ?? path.join(os.tmpdir(), 'nearpedia-agent');
const ASK_FOR_REPO = 'To start I need the public GitHub repository to migrate, as a link like https://github.com/owner/repo (add /tree/<branch> for a branch other than the default).';

async function api<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function upload(name: string, content: string, type: string): Promise<string> {
  const bytes = Buffer.from(content, 'utf8');
  const slot = await api<{ fileId: string; fileUrl: string | null; uploadUrl: string }>('POST', '/v1/files', { filename: name, byteSize: bytes.length, link: true });
  const put = await fetch(slot.uploadUrl.startsWith('http') ? slot.uploadUrl : `${BASE}${slot.uploadUrl}`, {
    method: 'PUT', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': type }, body: bytes,
  });
  if (!put.ok) throw new Error(`upload ${name} -> ${put.status}`);
  const done = await fetch(`${BASE}/v1/files/${slot.fileId}/complete`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } });
  const reply = await done.text();
  if (!done.ok && !(done.status === 409 && reply.includes('upload_not_pending'))) throw new Error(`complete ${name} -> ${done.status} ${reply.slice(0, 200)}`);
  return slot.fileUrl ?? slot.fileId;
}

async function guide(): Promise<string> {
  const res = await fetch(MIGRATION_GUIDE_URL);
  if (!res.ok) throw new Error(`migration guide ${res.status}`);
  return res.text();
}

async function migrate(repo: RepoRef, id: string, feedback?: string) {
  const cfg = nearAiConfig();
  if (!cfg) throw new Error('NEARAI_API_KEY is not set');
  return migrateRepo(getDb(), cfg, repo, { workdir: path.join(WORK_ROOT, id), guide: await guide(), feedback, log: (l) => console.log(l) });
}

async function work(row: AssignmentRow, mark: string, feedback?: string): Promise<void> {
  const id = row.assignment.assignmentId;
  const repo = repoFrom(`${row.job.description}\n${row.latestMessage?.body ?? ''}`);
  if (!repo) {
    await api('POST', `/v1/assignments/${id}/messages`, { body: ASK_FOR_REPO, clientRequestId: `${mark}-ask-repo` });
    return;
  }
  await api('POST', `/v1/assignments/${id}/messages`, { body: confirmMessage(repo, row.assignment.slaDeadlineAt, feedback !== undefined), clientRequestId: `${mark}-confirm` });
  const result = await migrate(repo, id, feedback);
  const report = renderReport(result, PATCH_NAME);
  const fit = fitDeliverable(feedback !== undefined ? withChanges(report, feedback) : report);
  const files = [
    ...(result.patch ? [await upload(PATCH_NAME, result.patch, 'text/x-diff')] : []),
    ...(fit.overflow ? [await upload(REPORT_FILE, fit.overflow, 'text/markdown')] : []),
  ];
  await api('POST', `/v1/assignments/${id}/submit`, { deliverableMarkdown: fit.markdown, files });
  fs.rmSync(path.join(WORK_ROOT, id), { recursive: true, force: true });
  logRun('agent-market', { status: 'success', items: result.results.length });
  console.log(`[agent] ${id}: submitted, ${result.results.filter((r) => r.status === 'migrated').length} files migrated`);
}

const done = new Set<string>();
const failures = new Map<string, { tries: number; at: number }>();

async function poll(): Promise<void> {
  const { assignments } = await api<{ assignments: AssignmentRow[] }>('GET', '/v1/agents/me/assignments?status=in_progress');
  for (const row of assignments) {
    const a = row.assignment;
    const step = nextStep(row);
    if (step.kind === 'skip' || done.has(step.mark)) continue;
    const failed = failures.get(step.mark);
    if (failed && (failed.tries >= MAX_TRIES || Date.now() - failed.at < RETRY_AFTER_MS)) continue;
    done.add(step.mark);
    try {
      if (!a.startedAt) await api('POST', `/v1/assignments/${a.assignmentId}/start`);
      await work(row, step.mark, step.feedback);
    } catch (e) {
      done.delete(step.mark);
      failures.set(step.mark, { tries: (failed?.tries ?? 0) + 1, at: Date.now() });
      logRun('agent-market', { status: 'error', items: 0, error: (e as Error).message.slice(0, 300) });
      console.error(`[agent] ${a.assignmentId}: ${(e as Error).message}`);
    }
  }
}

async function dryRun(url: string, out: string): Promise<void> {
  const repo = repoFrom(url);
  if (!repo) throw new Error(`not a GitHub repository link: ${url}`);
  const result = await migrate(repo, 'dry-run');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'report.md'), renderReport(result, PATCH_NAME));
  fs.writeFileSync(path.join(out, PATCH_NAME), result.patch);
  console.log(`report: ${path.join(out, 'report.md')}\npatch: ${path.join(out, PATCH_NAME)} (${result.patch.split('\n').length} lines)`);
}

async function main(): Promise<void> {
  const i = process.argv.indexOf('--dry-run');
  if (i > 0) return dryRun(process.argv[i + 1], process.argv[i + 2] ?? path.join(WORK_ROOT, 'out'));
  if (!/^aat_[0-9a-f]{32}$/.test(TOKEN)) throw new Error('AGENT_API_TOKEN (aat_…) is not set');
  console.log(`[agent] polling ${BASE} every ${POLL_MS / 1000}s`);
  for (;;) {
    await poll().catch((e) => console.error(`[agent] poll: ${(e as Error).message}`));
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
