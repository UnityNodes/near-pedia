import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'public', 'animations');
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('the animations', () => {
  it('ship at least the empty-state magnifier and the success check', () => {
    expect(files).toContain('search.json');
    expect(files).toContain('check-success.json');
  });

  for (const f of files) {
    it(`${f} is a small Lottie file that carries nothing it could run or fetch`, () => {
      const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
      const data = JSON.parse(raw) as { v: string; fr: number; ip: number; op: number; layers: unknown[]; assets?: { p?: string }[] };
      expect(Buffer.byteLength(raw), f).toBeLessThan(64 * 1024);
      expect(data.v).toMatch(/^\d+\.\d+/);
      expect(data.fr).toBeGreaterThan(0);
      expect(data.op).toBeGreaterThan(data.ip);
      expect(data.layers.length).toBeGreaterThan(0);
      expect(raw).not.toMatch(/"x"\s*:\s*"/);
      expect(raw).not.toMatch(/"ef"\s*:/);
      expect(raw).not.toMatch(/base64|https?:|<script/i);
      for (const a of data.assets ?? []) expect(a.p ?? '').toBe('');
    });
  }

  it('are each credited with their author, source and license next to the files', () => {
    const credits = fs.readFileSync(path.join(DIR, 'CREDITS.txt'), 'utf8');
    for (const f of files) expect(credits, `${f} has no credit`).toContain(f);
    expect(credits).toContain('Fernando Ron Pedrique');
    expect(credits).toContain('Travis Gregory');
    expect(credits).toContain('Lottie Simple License');
    expect(credits).toContain('https://lottiefiles.com/page/license');
  });

  it('are loaded lazily by one component, and nothing else imports the player', () => {
    const player = fs.readFileSync(path.join(ROOT, 'components', 'lottie-icon.tsx'), 'utf8');
    expect(player).toMatch(/import\('lottie-web\/build\/player\/lottie_light'\)/);
    expect(player).not.toMatch(/^import .*lottie-web/m);
    expect(player).toContain('prefers-reduced-motion');
    const importers = [...walk(path.join(ROOT, 'components')), ...walk(path.join(ROOT, 'app'))]
      .filter(p => /from ['"]lottie-web|import\(['"]lottie-web/.test(fs.readFileSync(p, 'utf8')))
      .map(p => path.relative(ROOT, p));
    expect(importers).toEqual(['components/lottie-icon.tsx']);
  });
});
