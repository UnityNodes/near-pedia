import { describe, expect, it } from 'vitest';
import { htmlText, markdownText } from '@/lib/html-text';

describe('markdownText', () => {
  it('drops issue-template comments and the tags of a dependabot table, keeping the text', () => {
    const body = '<!-- Thanks for the PR -->\nBumps <a href="https://github.com/x/y">near-sdk</a> from 5.1.0 to 5.2.0.\n<details>\n<summary>Release notes</summary>\n<p>Fixed &amp; improved</p>\n</details>';
    expect(markdownText(body)).toBe('Bumps near-sdk from 5.1.0 to 5.2.0.\n\nRelease notes\nFixed & improved');
  });

  it('keeps markdown, code and comparison signs that are not tags', () => {
    expect(markdownText('## Steps\n\n```rust\nlet a = b < c;\n```\n- item')).toBe('## Steps\n\n```rust\nlet a = b < c;\n```\n- item');
  });
});

describe('htmlText', () => {
  it('flattens a fragment to one line of text', () => {
    expect(htmlText('<p>One <b>two</b></p><p>three</p>')).toBe('One two three');
  });
});
