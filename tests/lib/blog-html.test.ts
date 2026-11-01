import { describe, expect, it } from 'vitest';
import { withHeadingIds } from '@/lib/blog-html';

describe('withHeadingIds', () => {
  it('gives each h2 and h3 an id and lists them in order with their level', () => {
    const { html, headings } = withHeadingIds('<p>a</p><h2>First idea</h2><p>b</p><h3>A <em>detail</em></h3>');
    expect(headings).toEqual([{ id: 'first-idea', text: 'First idea', level: 2 }, { id: 'a-detail', text: 'A detail', level: 3 }]);
    expect(html).toContain('<h2 id="first-idea">First idea</h2>');
    expect(html).toContain('<h3 id="a-detail">A <em>detail</em></h3>');
  });

  it('keeps two headings with the same words apart and replaces an id it finds', () => {
    const { html, headings } = withHeadingIds('<h2 id="old" class="x">Same</h2><h2>Same</h2>');
    expect(headings.map(h => h.id)).toEqual(['same', 'same-2']);
    expect(html).toContain('<h2 class="x" id="same">Same</h2>');
    expect(html).not.toContain('old');
  });

  it('decodes entities in the text and skips an empty heading', () => {
    const { headings, html } = withHeadingIds('<h2>Tom &amp; Jerry&nbsp;&#39;s</h2><h2> </h2>');
    expect(headings).toHaveLength(1);
    expect(headings[0].text).toBe("Tom & Jerry 's");
    expect(html).toContain('<h2> </h2>');
  });

  it('turns text with no letters into a safe id and leaves html without headings alone', () => {
    expect(withHeadingIds('<h2>***</h2>').headings[0].id).toBe('section');
    const plainHtml = '<p>nothing here</p>';
    expect(withHeadingIds(plainHtml)).toEqual({ html: plainHtml, headings: [] });
  });
});
