import { describe, it, expect } from 'vitest';
import { sanitizeDocHtml, sanitizeDiscourseHtml } from '@/lib/sanitize';

describe('sanitizeDocHtml', () => {
  it('strips script tags', () => {
    const out = sanitizeDocHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
    expect(out).toContain('<p>hi</p>');
  });

  it('strips inline event handlers', () => {
    const out = sanitizeDocHtml('<a href="x" onclick="evil()">click</a>');
    expect(out).not.toContain('onclick');
    expect(out).toContain('href="x"');
  });

  it('strips javascript: URLs', () => {
    const out = sanitizeDocHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });

  it('rewrites <a> with target=_blank and noopener noreferrer', () => {
    const out = sanitizeDocHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('adds loading=lazy to <img>', () => {
    const out = sanitizeDocHtml('<img src="/foo.png" alt="foo">');
    expect(out).toContain('loading="lazy"');
  });

  it('keeps tables for documentation', () => {
    const html = '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>';
    const out = sanitizeDocHtml(html);
    expect(out).toContain('<table');
    expect(out).toContain('<th>A</th>');
    expect(out).toContain('<td>1</td>');
  });

  it('keeps section/article for doc layout', () => {
    const out = sanitizeDocHtml('<section><article><p>x</p></article></section>');
    expect(out).toContain('<section>');
    expect(out).toContain('<article>');
  });

  it('drops unknown tags but keeps their text', () => {
    const out = sanitizeDocHtml('<custom-thing>hello</custom-thing>');
    expect(out).not.toContain('<custom-thing>');
    expect(out).toContain('hello');
  });
});

describe('sanitizeDiscourseHtml', () => {
  it('strips script tags', () => {
    expect(sanitizeDiscourseHtml('<script>x</script>p')).not.toContain('script');
  });

  it('keeps code blocks', () => {
    const out = sanitizeDiscourseHtml('<pre><code class="lang-ts">const x = 1;</code></pre>');
    expect(out).toContain('<pre>');
    expect(out).toContain('<code');
    expect(out).toContain('const x = 1;');
  });

  it('rewrites links with target=_blank and noopener noreferrer', () => {
    const out = sanitizeDiscourseHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('drops sections (only doc sanitizer keeps them)', () => {
    const out = sanitizeDiscourseHtml('<section><p>x</p></section>');
    expect(out).not.toContain('<section>');
    expect(out).toContain('x');
  });

  it('preserves blockquote for forum quotes', () => {
    const out = sanitizeDiscourseHtml('<blockquote>quoted</blockquote>');
    expect(out).toContain('<blockquote>');
    expect(out).toContain('quoted');
  });

  it('handles empty string', () => {
    expect(sanitizeDiscourseHtml('')).toBe('');
  });
});

describe('sanitize + CIP auto-link integration', () => {
  it('linkifies CIP-N mentions in doc HTML', () => {
    const out = sanitizeDocHtml('<p>See CIP-42 for the new token standard.</p>');
    expect(out).toContain('<a href="/cips/0042"');
    expect(out).toContain('CIP-0042');
    expect(out).toContain('new token standard');
  });

  it('linkifies CIP-N in Discourse HTML', () => {
    const out = sanitizeDiscourseHtml('<p>Replaced by CIP-100.</p>');
    expect(out).toContain('<a href="/cips/0100"');
    expect(out).toContain('CIP-0100');
  });

  it('does not double-wrap CIPs already inside existing anchors', () => {
    const out = sanitizeDocHtml('<p>Existing <a href="/cips/0042">CIP-0042</a> link plus CIP-7 plain.</p>');
    // Count nested anchors — should be 0 (a-inside-a would be malformed).
    const inner = out.match(/<a[^>]*>\s*<a/);
    expect(inner).toBeNull();
    // Plain CIP-7 still gets linkified to 0007.
    expect(out).toContain('href="/cips/0007"');
    expect(out).toContain('CIP-0007');
  });

  it('preserves padding inside HTML — CIP-1 → CIP-0001', () => {
    const out = sanitizeDocHtml('Hello CIP-1 world');
    expect(out).toContain('href="/cips/0001"');
    expect(out).toContain('CIP-0001');
  });

  it('preserves XSS protection while linkifying', () => {
    const out = sanitizeDocHtml('<script>alert(1)</script>CIP-9');
    expect(out).not.toContain('<script');
    expect(out).toContain('href="/cips/0009"');
  });
});
