import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const server = JSON.parse(fs.readFileSync(path.join(ROOT, 'server.json'), 'utf8')) as {
  remotes: { url: string }[];
  icons?: { src: string; mimeType?: string; sizes?: string[] }[];
};

const MIME: Record<string, string> = { '.png': 'image/png', '.svg': 'image/svg+xml' };

function pngSize(file: string): string {
  const b = fs.readFileSync(file);
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

describe('server.json icons', () => {
  const origin = new URL(server.remotes[0].url).origin;

  it('lists at least one PNG, as registry clients must render PNG', () => {
    expect(server.icons?.some((i) => i.mimeType === 'image/png')).toBe(true);
  });

  it.each(server.icons ?? [])('$src is a file the site serves, with the declared type and size', (icon) => {
    const url = new URL(icon.src);
    expect(url.protocol).toBe('https:');
    expect(url.origin).toBe(origin);
    const file = path.join(ROOT, 'public', url.pathname);
    expect(fs.existsSync(file)).toBe(true);
    expect(icon.mimeType).toBe(MIME[path.extname(file)]);
    if (icon.mimeType === 'image/png') expect(icon.sizes).toEqual([pngSize(file)]);
    else expect(icon.sizes).toEqual(['any']);
  });
});
