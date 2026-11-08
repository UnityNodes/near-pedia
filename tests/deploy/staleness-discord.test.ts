import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.resolve(__dirname, '../../scripts/check-sync-staleness.sh');

const METRICS = [
  'nearpedia_sync_completion_age_seconds{source="forum"} 99999',
  'nearpedia_sync_tolerance_seconds{source="forum"} 3600',
  'nearpedia_sync_completion_age_seconds{source="docs"} 10',
  'nearpedia_sync_tolerance_seconds{source="docs"} 3600',
].join('\n');

function run(extra: Record<string, string>, metrics = METRICS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staleness-'));
  const posts = path.join(dir, 'posts');
  fs.writeFileSync(path.join(dir, 'metrics'), metrics);
  fs.writeFileSync(path.join(dir, 'curl'), [
    '#!/usr/bin/env bash',
    'for a in "$@"; do',
    `  if [[ "$a" == */api/metrics* ]]; then cat "${dir}/metrics"; exit 0; fi`,
    'done',
    'body=""; prev=""',
    'for a in "$@"; do [[ "$prev" == --data ]] && body="$a"; prev="$a"; done',
    `[[ "$body" == @- ]] && body="$(cat)"`,
    `printf '%s\\t%s\\n' "\${@: -1}" "$body" >> "${posts}"`,
  ].join('\n'), { mode: 0o755 });
  const r = spawnSync('bash', [SCRIPT], {
    env: { PATH: `${dir}:/usr/bin:/bin`, BASE_URL: 'http://127.0.0.1:3130', ALERT_QUIET_FILE: path.join(dir, 'quiet'), NODE_ENV: 'test' as const, ...extra },
    encoding: 'utf8', timeout: 10_000,
  });
  const sent = fs.existsSync(posts) ? fs.readFileSync(posts, 'utf8').trim().split('\n').map((l) => l.split('\t')) : [];
  fs.rmSync(dir, { recursive: true, force: true });
  return { ...r, sent };
}

describe('check-sync-staleness.sh Discord alert', () => {
  it('posts the stale list to the ops Discord webhook, mentions off', () => {
    const r = run({ OPS_DISCORD_WEBHOOK_URL: 'https://discord.test/api/webhooks/1/x' });
    expect(r.status).toBe(1);
    expect(r.sent).toHaveLength(1);
    const [url, body] = r.sent[0];
    expect(url).toBe('https://discord.test/api/webhooks/1/x');
    const msg = JSON.parse(body) as { content: string; allowed_mentions: { parse: string[] } };
    expect(msg.allowed_mentions.parse).toEqual([]);
    expect(msg.content).toMatch(/stale sources \(1\)/);
    expect(msg.content).toMatch(/forum \(99999s > 3600s\)/);
    expect(msg.content).not.toMatch(/docs/);
  });

  it('sends nothing when every source is fresh', () => {
    const fresh = METRICS.replace('99999', '5');
    const r = run({ OPS_DISCORD_WEBHOOK_URL: 'https://discord.test/api/webhooks/1/x' }, fresh);
    expect(r.status).toBe(0);
    expect(r.sent).toHaveLength(0);
  });

  it('only logs when no webhook is set', () => {
    const r = run({});
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/STALE/);
    expect(r.sent).toHaveLength(0);
  });
});
