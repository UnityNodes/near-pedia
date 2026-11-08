import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { VERSION } from '@/lib/version';
import { OPENAPI_SPEC } from '@/lib/openapi-spec';
import { compareVersions } from '@/lib/release-version';

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const json = (f: string) => JSON.parse(read(f)) as { version?: string };

describe('one version for the whole release', () => {
  it('reads package.json', () => {
    expect(VERSION).toBe(json('package.json').version);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is the version the registry manifests publish', () => {
    expect(json('server.json').version).toBe(VERSION);
    const plugin = json('plugin/.claude-plugin/plugin.json');
    if (plugin.version !== undefined) expect(plugin.version).toBe(VERSION);
  });

  it('is what the OpenAPI document reports', () => {
    expect(OPENAPI_SPEC.info.version).toBe(VERSION);
  });

  it('is not typed out anywhere a server reports it', () => {
    for (const f of ['mcp-server.ts', 'app/api/health/route.ts', 'lib/openapi-spec.ts']) {
      expect(read(f), f).not.toMatch(/version:\s*['"`]\d+\.\d+\.\d+['"`]/);
      expect(read(f), f).not.toMatch(/npm_package_version/);
    }
  });

  it('is not behind the newest release tag', () => {
    const r = spawnSync('git', ['tag', '--list', 'v*', '--sort=-v:refname'], { cwd: ROOT, encoding: 'utf8' });
    const newest = r.status === 0 ? r.stdout.split('\n').find((t) => /^v\d+\.\d+\.\d+$/.test(t)) : undefined;
    if (!newest) return;
    expect(compareVersions(VERSION, newest.slice(1))).toBeGreaterThanOrEqual(0);
  });
});
