import { describe, it, expect } from 'vitest';
import { notesHtml, releaseSummary } from '@/lib/release-text';
import { compareVersions, releaseLine } from '@/lib/release-version';

const NOTES = [
  '# Release of yourchain-node 1.4.2',
  '',
  'yourchain-node 1.4.2 has been released on October 22, 2026.',
  '',
  '## Summary',
  '',
  'This is a maintenance release that fixes slow state sync on large databases.',
  '',
  '## What’s New',
  '',
  'Faster state sync.',
].join('\n');

describe('releaseSummary', () => {
  it('reads the Summary section of a release note, not its title or release-date line', () => {
    expect(releaseSummary(NOTES)).toBe('This is a maintenance release that fixes slow state sync on large databases.');
  });

  it('has nothing to say for a note that only points elsewhere', () => {
    expect(releaseSummary('See the release notes blog for details.')).toBe('');
    expect(releaseSummary(null)).toBe('');
  });

  it('joins the first changes of a changelog list without contributor credits, and skips a list of links', () => {
    expect(releaseSummary("## What's Changed\n* Version comment in yaml by @alice in https://github.com/x/pull/283\n* update go dependencies by @bob in https://github.com/x/pull/280")).toBe('Version comment in yaml; update go dependencies');
    expect(releaseSummary('### Downloads:\n  - [macOS tarball](https://x/a.tgz) | [Linux tarball](https://x/b.tgz)')).toBe('');
  });

  it('cuts a long summary at a word with an ellipsis', () => {
    const long = releaseSummary(`## Summary\n\n${'word '.repeat(80)}`, 40);
    expect(long.length).toBeLessThanOrEqual(41);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('notesHtml', () => {
  it('drops the note title the page already shows and turns any other top heading into a section', () => {
    expect(notesHtml('<h1>Release of yourchain-node 1.4.2</h1><p>x</p><h2 id="s">Summary</h2>')).toBe('<p>x</p><h2 id="s">Summary</h2>');
    expect(notesHtml('<h1 class="a">Highlights</h1><p>y</p>')).toBe('<h2 class="a">Highlights</h2><p>y</p>');
  });
});

describe('release versions', () => {
  it('names the line of a version and orders versions with a pre-release below its release', () => {
    expect(releaseLine('v1.4.2')).toBe('1.4');
    expect(releaseLine(null)).toBeNull();
    expect(compareVersions('1.10.0', '1.9.3')).toBe(1);
    expect(compareVersions('1.4.2-testnet', '1.4.2')).toBe(-1);
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0);
  });
});
