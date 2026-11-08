export const MARKER = '<!-- nearpedia-check -->';
export const MAX_CODE = 20_000;

const CHECKED = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|rs)$|(^|\/)(Cargo\.toml|package\.json)$/;
const SKIPPED_DIRS = /(^|\/)(node_modules|target|dist|build|out|vendor|\.next)\//;
const RANK = { error: 0, warning: 1, info: 2 };

export function isChecked(path) {
  return CHECKED.test(path) && !SKIPPED_DIRS.test(path) && !/\.d\.ts$/.test(path) && !/\.min\.js$/.test(path);
}

export function addedLines(patch) {
  const added = new Set();
  if (!patch) return added;
  let line = 0;
  for (const row of patch.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (row.startsWith('+') && !row.startsWith('+++')) {
      added.add(line);
      line++;
    } else if (!row.startsWith('-') && !row.startsWith('\\')) {
      line++;
    }
  }
  return added;
}

export function clip(code) {
  if (code.length <= MAX_CODE) return { code, cut: false };
  const end = code.lastIndexOf('\n', MAX_CODE);
  return { code: code.slice(0, end > 0 ? end : MAX_CODE), cut: true };
}

export function shouldFail(findings, failOn) {
  if (failOn === 'error') return findings.some((f) => f.isNew && f.severity === 'error');
  if (failOn === 'warning') return findings.some((f) => f.isNew && (f.severity === 'error' || f.severity === 'warning'));
  return false;
}

const flat = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
const cell = (text) => flat(text).replace(/@(?=[A-Za-z0-9])/g, '@\u200b');
const code = (text) => `<code>${flat(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`;

function status(f) {
  if (f.entry) return `${f.entry.status.replace('_', ' ')}${f.entry.strength === 'weak' ? ' (weak signal)' : ''}`;
  return f.via === 'version' ? 'old version' : f.via === 'yank' ? 'yanked' : f.severity;
}

function insteadOf(f) {
  if (f.entry?.replacement) return f.entry.replacement_url ? `[${cell(f.entry.replacement)}](${f.entry.replacement_url})` : cell(f.entry.replacement);
  return f.via === 'version' ? 'upgrade after reading the release notes' : '';
}

function row(f, blob) {
  const source = f.sources?.[0];
  const sourceCell = source ? `[${cell(new URL(source.url).hostname.replace(/^www\./, ''))}](${source.url})${source.date ? ` ${source.date}` : ''}` : '';
  return `| ${f.severity === 'error' ? '**error**' : f.severity} | [${cell(f.file)}:${f.line}](${blob(f.file, f.line)}) | ${code(f.matched)} | ${status(f)} | ${insteadOf(f)} | ${sourceCell} |`;
}

function table(findings, blob) {
  return ['| | Where | Uses | Status | Use instead | Source |', '|---|---|---|---|---|---|', ...findings.map((f) => row(f, blob))].join('\n');
}

function explain(findings) {
  const seen = new Map();
  for (const f of findings) {
    const key = f.entry?.id ?? `${f.via}:${f.matched}`;
    if (!seen.has(key)) seen.set(key, f);
  }
  return [...seen.values()].map((f) => `- ${code(f.matched)}: ${cell(f.message)}${f.live ? ` ${cell(f.live)}` : ''}`).join('\n');
}

export function sortFindings(findings) {
  return [...findings].sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.file.localeCompare(b.file) || a.line - b.line);
}

export function renderComment({ findings, basis, skipped, site, blob }) {
  const fresh = sortFindings(findings.filter((f) => f.isNew));
  const older = sortFindings(findings.filter((f) => !f.isNew));
  const parts = [MARKER];
  if (findings.length === 0) {
    parts.push('### NEARpedia: no stale NEAR code in the files this pull request changes');
  } else {
    parts.push(`### NEARpedia: ${fresh.length} ${fresh.length === 1 ? 'line' : 'lines'} this pull request adds ${fresh.length === 1 ? 'uses' : 'use'} something NEAR deprecated, removed or changed`);
    if (fresh.length) parts.push(table(fresh, blob));
    if (older.length) parts.push(`<details><summary>${older.length} more in the changed files, on lines this pull request does not touch</summary>\n\n${table(older, blob)}\n\n</details>`);
    parts.push(`<details><summary>Why, with the evidence</summary>\n\n${explain([...fresh, ...older])}\n\n</details>`);
  }
  if (skipped.length) parts.push(`<sub>Not checked: ${skipped.map((s) => `${code(s.file)} (${cell(s.reason)})`).join(', ')}.</sub>`);
  const built = basis?.built_at ? `, built ${basis.built_at.slice(0, 10)}` : '';
  parts.push(`<sub>Checked by [NEARpedia](${site}) against its index of ${basis?.entries ?? '?'} NEAR deprecations${built}. Every row links the source it comes from.</sub>`);
  return parts.join('\n\n');
}

export function annotation(f) {
  const level = f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'notice';
  const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const prop = (s) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
  return `::${level} file=${prop(f.file)},line=${f.line},title=${prop(`NEARpedia: ${f.matched}`)}::${esc(f.message)}`;
}

function resetAt(reset) {
  const at = Number(reset);
  return Number.isFinite(at) && at > 0 ? ` (it resets at ${new Date(at * 1000).toISOString().slice(0, 16)} UTC)` : '';
}

export function githubError({ status, path, method = 'GET', body = '', remaining, reset, hasToken = false }) {
  const text = String(body);
  const rateLimited = (status === 403 || status === 429) && (remaining === '0' || /rate limit/i.test(text));
  if (rateLimited && hasToken) return `GitHub ${method} ${path}: ${status}, the token has no calls left this hour${resetAt(reset)}.`;
  if (rateLimited) return `GitHub ${method} ${path}: ${status}, the unauthenticated rate limit is used up: GitHub allows 60 calls an hour per address without a token${resetAt(reset)}. Run again with env INPUT_GITHUB-TOKEN=<token> (a token with no scopes is enough for a public repository), or wait for the reset.`;
  if (status === 403) return `GitHub ${method} ${path}: 403, the token has no permission for this: ${text.slice(0, 200)}`;
  return `GitHub ${method} ${path}: ${status} ${text.slice(0, 200)}`;
}

export function pullRequestOf(event) {
  const pr = event?.pull_request;
  if (!pr) return null;
  if (typeof pr.number !== 'number') {
    const why = typeof pr.message === 'string' ? pr.message : 'it has no number';
    throw new Error(`the event's pull_request is not a pull request (${why}). In a dry run this is the curl that built the event hitting GitHub's rate limit: wait for the reset, or add -H "Authorization: Bearer <token>" to that curl.`);
  }
  return pr;
}

export const CHECK_TRIES = 3;
export const CHECK_TIMEOUT_MS = 30_000;
const RETRY_DEFAULT_S = 5;
const RETRY_MAX_S = 30;

export class UnreachableError extends Error {}

export const isRetryableStatus = (status) => status === 429 || status >= 500;

function networkReason(e) {
  const cause = e?.cause?.code ?? e?.cause?.message;
  if (e?.name === 'TimeoutError') return `no answer in ${CHECK_TIMEOUT_MS / 1000} s`;
  return `network error: ${cause ?? e?.message ?? String(e)}`;
}

export async function requestCheck({ site, file, code, fetchImpl = fetch, sleep, tries = CHECK_TRIES }) {
  let reason = '';
  for (let attempt = 0; attempt < tries; attempt++) {
    let res;
    try {
      res = await fetchImpl(`${site}/api/v1/check-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'nearpedia-github-action/1' },
        body: JSON.stringify({ filename: file, code }),
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
    } catch (e) {
      reason = networkReason(e);
      if (attempt + 1 < tries) await sleep(RETRY_DEFAULT_S * 1000);
      continue;
    }
    if (isRetryableStatus(res.status)) {
      reason = `HTTP ${res.status}`;
      if (attempt + 1 < tries) await sleep(Math.min(Number(res.headers.get('retry-after')) || RETRY_DEFAULT_S, RETRY_MAX_S) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`NEARpedia check-code ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
  throw new UnreachableError(`${site} did not answer after ${tries} tries (last: ${reason})`);
}

export function unreachableOutcome({ reason, failOn }) {
  const fails = failOn !== 'never';
  const verdict = fails ? `The job fails because fail-on is ${failOn}.` : 'The job passes; set fail-on to warning or error to fail it instead.';
  return {
    summary: `## NEARpedia check\n\nNEARpedia unreachable: ${reason}. No files were checked. ${verdict}\n`,
    annotation: `::warning::NEARpedia unreachable: ${reason}. No files were checked. ${verdict}`,
    exitCode: fails ? 1 : 0,
  };
}
