import { appendFileSync, readFileSync } from 'node:fs';
import { MARKER, addedLines, annotation, clip, isChecked, renderComment, shouldFail } from './lib.mjs';

const input = (name, fallback = '') => (process.env[`INPUT_${name.toUpperCase().replace(/ /g, '_')}`] ?? fallback).trim() || fallback;

const token = input('github-token');
const site = input('api-url', 'https://near-pedia.xyz').replace(/\/+$/, '');
const failOn = input('fail-on', 'never');
const postComment = input('comment', 'true') !== 'false';
const maxFiles = Number(input('max-files', '40')) || 40;
const api = process.env.GITHUB_API_URL ?? 'https://api.github.com';
const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gh(path, init = {}) {
  const res = await fetch(`${api}${path}`, {
    ...init,
    headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

async function pages(path) {
  const out = [];
  for (let page = 1; page <= 30; page++) {
    const batch = await (await gh(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)).json();
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

async function checkCode(file, code) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${site}/api/v1/check-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'nearpedia-github-action/1' },
      body: JSON.stringify({ filename: file, code }),
    });
    if (res.status === 429 || res.status >= 500) {
      await sleep(Math.min(Number(res.headers.get('retry-after')) || 5, 30) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`NEARpedia check-code ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
  throw new Error('NEARpedia did not answer after three tries');
}

async function upsertComment(repo, number, body) {
  const existing = (await pages(`/repos/${repo}/issues/${number}/comments`)).find((c) => c.body?.includes(MARKER));
  if (existing) return gh(`/repos/${repo}/issues/comments/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
  return gh(`/repos/${repo}/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
}

async function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const pr = event.pull_request;
  if (!pr) {
    console.log('NEARpedia check runs on pull_request events; nothing to do here.');
    return;
  }
  const repo = process.env.GITHUB_REPOSITORY;
  const headRepo = pr.head.repo?.full_name ?? repo;
  const sha = pr.head.sha;
  const blob = (file, line) => `${server}/${headRepo}/blob/${sha}/${file.split('/').map(encodeURIComponent).join('/')}#L${line}`;

  const files = (await pages(`/repos/${repo}/pulls/${pr.number}/files`)).filter((f) => f.status !== 'removed' && isChecked(f.filename));
  const skipped = files.slice(maxFiles).map((f) => ({ file: f.filename, reason: `over the ${maxFiles}-file limit` }));
  const findings = [];
  let basis = null;
  for (const f of files.slice(0, maxFiles)) {
    const raw = await (await gh(`/repos/${headRepo}/contents/${f.filename.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`, { headers: { Accept: 'application/vnd.github.raw' } })).text();
    if (!raw.trim()) continue;
    const { code, cut } = clip(raw);
    if (cut) skipped.push({ file: f.filename, reason: 'only its first 20,000 characters were checked' });
    const result = await checkCode(f.filename, code);
    basis = result.basis ?? basis;
    const added = addedLines(f.patch);
    for (const finding of result.findings) findings.push({ ...finding, file: f.filename, isNew: added.has(finding.line) });
  }

  for (const f of findings.filter((x) => x.isNew)) console.log(annotation(f));
  const body = renderComment({ findings, basis, skipped, site, blob });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
  if (postComment && (findings.length > 0 || skipped.length > 0)) {
    try {
      await upsertComment(repo, pr.number, body);
    } catch (e) {
      console.log(`::warning::Could not comment on the pull request (a fork's token is read-only): ${e.message}. The report is in the job summary.`);
    }
  } else if (postComment) {
    const existing = (await pages(`/repos/${repo}/issues/${pr.number}/comments`)).find((c) => c.body?.includes(MARKER));
    if (existing) await upsertComment(repo, pr.number, body).catch(() => {});
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `findings=${findings.length}\nnew-findings=${findings.filter((f) => f.isNew).length}\n`);
  if (shouldFail(findings, failOn)) {
    console.log(`::error::NEARpedia found stale NEAR code on lines this pull request adds (fail-on: ${failOn}).`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.log(`::error::NEARpedia check failed: ${e.message}`);
  process.exitCode = 1;
});
