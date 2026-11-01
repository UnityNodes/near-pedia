import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(__dirname, '..', '..');
const doc = fs.readFileSync(path.join(ROOT, 'docs', 'template', 'updates.md'), 'utf8');

const PACKAGES = [
  { name: 'resources-and-cips', newMarker: 'New files, copied as they are', sharedMarker: 'Shared files, changed by the patch' },
  { name: 'docs-index', newMarker: 'New files for the docs index, copied as they are', sharedMarker: 'Shared files for the docs index, changed by the patch' },
  { name: 'glossary', newMarker: 'New files for the glossary, copied as they are', sharedMarker: 'Shared files for the glossary, changed by the patch' },
  { name: 'whitepapers', newMarker: 'New files for the whitepapers reader, copied as they are', sharedMarker: 'Shared files for the whitepapers reader, changed by the patch' },
  { name: 'releases', newMarker: 'New files for the releases page, copied as they are', sharedMarker: 'Shared files for the releases page, changed by the patch' },
  { name: 'videos', newMarker: 'New files for the videos pages, copied as they are', sharedMarker: 'Shared files for the videos pages, changed by the patch' },
  { name: 'blog', newMarker: 'New files for the blog pages, copied as they are', sharedMarker: 'Shared files for the blog pages, changed by the patch' },
];

function block(after: string): string[] {
  const i = doc.indexOf(after);
  if (i === -1) throw new Error(`the guide has no "${after}"`);
  const start = doc.indexOf('```text\n', i) + '```text\n'.length;
  const end = doc.indexOf('\n```', start);
  return doc.slice(start, end).split('\n').map(l => l.trim()).filter(Boolean);
}

describe.each(PACKAGES)('the updates guide, package $name', ({ name, newMarker, sharedMarker }) => {
  const patch = fs.readFileSync(path.join(ROOT, 'docs', 'template', 'patches', `${name}.patch`), 'utf8');
  const listFile = fs.readFileSync(path.join(ROOT, 'docs', 'template', 'patches', `${name}.files`), 'utf8');
  const newFiles = block(newMarker);
  const sharedFiles = block(sharedMarker);
  const patched = [...patch.matchAll(/^diff --git a\/(\S+) b\/\S+$/gm)].map(m => m[1]);

  it('lists the new files once in the guide and once in the file the tar command reads, and they are the same', () => {
    expect(newFiles.length).toBeGreaterThan(1);
    expect(listFile.split('\n').map(l => l.trim()).filter(Boolean)).toEqual(newFiles);
  });

  it('names only files that exist in this tree', () => {
    for (const f of [...newFiles, ...sharedFiles]) expect(fs.existsSync(path.join(ROOT, f)), f).toBe(true);
  });

  it('names as shared files exactly the files the patch changes', () => {
    expect([...sharedFiles].sort()).toEqual([...patched].sort());
  });

  it('keeps new files and patched files apart', () => {
    for (const f of newFiles) expect(sharedFiles.includes(f), f).toBe(false);
  });
});
