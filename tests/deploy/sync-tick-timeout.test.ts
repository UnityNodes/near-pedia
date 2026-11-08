import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TICK = path.resolve(__dirname, '../../deploy/sync-tick.sh');
const text = fs.readFileSync(TICK, 'utf8');

function bucketCaps(): Record<string, number> {
  const line = text.split('\n').find((l) => l.startsWith('declare -A BUCKET_CAP='));
  if (!line) throw new Error('BUCKET_CAP is not declared in sync-tick.sh');
  const r = spawnSync('bash', ['-c', `${line}; for k in "\${!BUCKET_CAP[@]}"; do echo "$k=\${BUCKET_CAP[$k]}"; done`], { encoding: 'utf8' });
  return Object.fromEntries(r.stdout.trim().split('\n').map((l) => { const [k, v] = l.split('='); return [k, Number(v)]; }));
}

function scheduledBuckets(): string[] {
  return [...text.matchAll(/^\s*([a-z]+)\)\s+.*;;\s*$/gm)].map((m) => m[1]);
}

function harness(cap: number, script: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-tick-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const calls = path.join(dir, 'alert-calls');
  fs.writeFileSync(path.join(bin, 'npx'), [
    '#!/usr/bin/env bash',
    `if [[ "$2" == scripts/alert-crash.ts ]]; then printf '%s\\n' "$@" > "${calls}"; exit 0; fi`,
    'case "$2" in',
    '  scripts/hangs.ts) echo started >&2; exec sleep 30 ;;',
    '  scripts/fails.ts) echo boom >&2; exit 3 ;;',
    '  *) exit 0 ;;',
    'esac',
  ].join('\n'), { mode: 0o755 });
  const fn = text.match(/^exec_script\(\) \{[\s\S]*?^\}$/m)?.[0];
  if (!fn) throw new Error('exec_script not found in sync-tick.sh');
  const prog = `BUCKET=medium; CAP=${cap}; KILL_GRACE=1; stamp() { date -Iseconds; }\n${fn}\nexec_script ${script} ${script}`;
  const started = Date.now();
  const r = spawnSync('bash', ['-c', prog], { env: { PATH: `${bin}:/usr/bin:/bin`, NODE_ENV: 'test' as const }, encoding: 'utf8', timeout: 20_000 });
  const elapsed = Date.now() - started;
  const alert = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n') : null;
  fs.rmSync(dir, { recursive: true, force: true });
  return { ...r, elapsed, alert };
}

describe('sync-tick.sh per-bucket time cap', () => {
  it('gives every scheduled bucket a cap, with the values the runbook names', () => {
    const caps = bucketCaps();
    for (const b of scheduledBuckets().filter((b) => b !== 'all')) expect(caps[b], b).toBeGreaterThan(0);
    expect(caps).toMatchObject({ fast: 600, medium: 600, slow: 1800, daily: 7200 });
  });

  it('runs each script under timeout with the bucket cap and a kill grace', () => {
    expect(text).toMatch(/timeout -k "\$KILL_GRACE" "\$CAP" npx tsx "scripts\/\$s\.ts"/);
  });

  it('kills a hung script at the cap, logs it and files a crash row', () => {
    const r = harness(1, 'hangs');
    expect(r.elapsed).toBeLessThan(10_000);
    expect(r.stderr).toMatch(/hangs TIMED OUT after 1s \(exit 124\)/);
    expect(r.alert?.slice(1, 4)).toEqual(['scripts/alert-crash.ts', 'hangs', '124']);
    expect(r.alert?.[5]).toMatch(/^timed out after 1s in the medium bucket/);
  });

  it('still reports an ordinary failure as FAILED, not as a timeout', () => {
    const r = harness(5, 'fails');
    expect(r.stderr).toMatch(/fails FAILED \(exit 3\)/);
    expect(r.stderr).not.toMatch(/TIMED OUT/);
    expect(r.alert?.[3]).toBe('3');
  });

  it('passes a script that finishes in time', () => {
    const r = harness(5, 'quick');
    expect(r.stdout).toMatch(/quick ok/);
    expect(r.alert).toBeNull();
  });
});
