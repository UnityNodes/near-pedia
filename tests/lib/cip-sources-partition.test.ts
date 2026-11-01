import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(__dirname, '..', '..');

describe('the published sources split proposals from open pull requests', () => {
  const server = fs.readFileSync(path.join(ROOT, 'mcp-server.ts'), 'utf8');

  it('counts a numbered row as a proposal and a row without a number as a pull request, with no overlap and no gap', () => {
    expect(server).toMatch(/type: 'cip',[^\n]*COUNT\(\*\) c FROM cips WHERE cip_number IS NOT NULL/);
    expect(server).toMatch(/type: 'cip_pull_request',[^\n]*COUNT\(\*\) c FROM cips WHERE cip_number IS NULL/);
    expect(server).not.toMatch(/type: 'cip',[^\n]*COUNT\(\*\) c FROM cips'\)/);
  });

  it('gives the pull request source a tile on the home widget', () => {
    const widget = fs.readFileSync(path.join(ROOT, 'components', 'sources-live.tsx'), 'utf8');
    expect(widget).toContain('cip_pull_request:');
  });
});
