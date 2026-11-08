import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';

const SCRIPT = path.resolve(__dirname, '../../scripts/sync-near.sh');

describe('sync-near.sh without GITHUB_TOKEN', () => {
  it('stops before the first step and points at db:seed instead of dying on a GitHub 403 minutes in', () => {
    const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NODE_ENV: 'test' as const };
    const r = spawnSync('bash', [SCRIPT], { env, encoding: 'utf8', timeout: 10_000 });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/GITHUB_TOKEN/);
    expect(r.stderr).toMatch(/npm run db:seed/);
    expect(r.stdout).not.toMatch(/== sync-/);
  });
});
