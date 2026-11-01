import { describe, it, expect } from 'vitest';
import {
  descriptionFromWatchPage, descriptionParagraphs, descriptionParts, extractJsonObject, resolveDescription,
} from '@/lib/video-description';

const redirect = (target: string) => `https://www.youtube.com/redirect?event=video_description&redir_token=abc&q=${encodeURIComponent(target)}&v=x`;

describe('resolveDescription', () => {
  it('replaces the shortened display text with the real target', () => {
    const content = 'Read more here: https://www.example.com/use-case...';
    const start = content.indexOf('https');
    const resolved = resolveDescription({
      content,
      commandRuns: [{ startIndex: start, length: content.length - start, onTap: { innertubeCommand: { urlEndpoint: { url: redirect('https://www.example.com/use-cases/overview') } } } }],
    });
    expect(resolved).toBe('Read more here: https://www.example.com/use-cases/overview');
  });

  it('keeps indices valid when several links are replaced', () => {
    const content = 'A https://a.io/x... and B https://b.io/y...';
    const a = content.indexOf('https://a');
    const b = content.indexOf('https://b');
    const resolved = resolveDescription({
      content,
      commandRuns: [
        { startIndex: a, length: 'https://a.io/x...'.length, onTap: { innertubeCommand: { urlEndpoint: { url: redirect('https://a.io/long/path') } } } },
        { startIndex: b, length: 'https://b.io/y...'.length, onTap: { innertubeCommand: { urlEndpoint: { url: redirect('https://b.io/other/path') } } } },
      ],
    });
    expect(resolved).toBe('A https://a.io/long/path and B https://b.io/other/path');
  });

  it('leaves runs that are not outbound links untouched', () => {
    const resolved = resolveDescription({
      content: 'Chapter 0:00 intro',
      commandRuns: [{ startIndex: 8, length: 4, onTap: { innertubeCommand: { urlEndpoint: { url: 'https://www.youtube.com/watch?v=x&t=0s' } } } }],
    });
    expect(resolved).toBe('Chapter 0:00 intro');
  });

  it('leaves the text alone when the run does not cover link text', () => {
    const content = '🔗 Learn more: https://a.example/long...';
    const resolved = resolveDescription({
      content,
      commandRuns: [{ startIndex: 3, length: 12, onTap: { innertubeCommand: { urlEndpoint: { url: redirect('https://a.example/long/path') } } } }],
    });
    expect(resolved).toBe(content);
  });

  it('fixes a link shown without a scheme', () => {
    const content = 'Docs: www.example.com/gu...';
    const resolved = resolveDescription({
      content,
      commandRuns: [{ startIndex: 6, length: content.length - 6, onTap: { innertubeCommand: { urlEndpoint: { url: redirect('https://www.example.com/guide/start') } } } }],
    });
    expect(resolved).toBe('Docs: https://www.example.com/guide/start');
  });

  it('returns null without content', () => {
    expect(resolveDescription({})).toBeNull();
    expect(resolveDescription({ content: '' })).toBeNull();
  });
});

describe('extractJsonObject', () => {
  it('finds a balanced object and ignores braces inside strings', () => {
    const source = 'x"key":{"a":"}{","b":{"c":1}} trailing';
    expect(extractJsonObject(source, source.indexOf('"key":') + 6)).toBe('{"a":"}{","b":{"c":1}}');
  });

  it('returns null for an unterminated object', () => {
    expect(extractJsonObject('{"a":1', 0)).toBeNull();
  });

  it('only reads an object that starts right where it was told to look', () => {
    const source = '"attributedDescription":null,"other":{"content":"INJECTED"}';
    expect(extractJsonObject(source, '"attributedDescription":'.length)).toBeNull();
    expect(extractJsonObject('"k":  {"a":1}', 4)).toBe('{"a":1}');
  });
});

describe('descriptionFromWatchPage', () => {
  it('reads the attributed description and resolves its links', () => {
    const body = JSON.stringify({
      content: 'See https://x.io/a...',
      commandRuns: [{ startIndex: 4, length: 17, onTap: { innertubeCommand: { urlEndpoint: { url: redirect('https://x.io/abc') } } } }],
    });
    const html = `<script>var d = {"attributedDescription":${body},"headerRuns":[]};</script>`;
    expect(descriptionFromWatchPage(html)).toBe('See https://x.io/abc');
  });

  it('skips an earlier key whose value is not an object', () => {
    const body = JSON.stringify({ content: 'second one', commandRuns: [] });
    const html = `{"attributedDescription":null,"x":1} {"attributedDescriptionBodyText":${body}}`;
    expect(descriptionFromWatchPage(html)).toBe('second one');
  });

  it('returns null when the page has no description block', () => {
    expect(descriptionFromWatchPage('<html></html>')).toBeNull();
  });
});

describe('descriptionParts', () => {
  it('turns URLs into links and trims trailing punctuation', () => {
    const parts = descriptionParts('Docs: https://docs.example.com/start, then more.');
    expect(parts).toEqual([
      { kind: 'text', text: 'Docs: ' },
      { kind: 'link', href: 'https://docs.example.com/start', label: 'docs.example.com/start' },
      { kind: 'text', text: ', then more.' },
    ]);
  });

  it('keeps a closing parenthesis that belongs to the URL and drops one that does not', () => {
    const inside = descriptionParts('see https://en.wikipedia.org/wiki/Foo_(bar)');
    expect(inside.find(p => p.kind === 'link')).toMatchObject({ href: 'https://en.wikipedia.org/wiki/Foo_(bar)' });
    const outside = descriptionParts('(see https://a.example/x)');
    expect(outside.find(p => p.kind === 'link')).toMatchObject({ href: 'https://a.example/x' });
  });

  it('does not make a link from a bare scheme', () => {
    expect(descriptionParts('broken https://) text').every(p => p.kind === 'text')).toBe(true);
  });

  it('does not link a shortened URL', () => {
    const parts = descriptionParts('Read https://www.example.com/use-case...');
    expect(parts.every(p => p.kind === 'text')).toBe(true);
  });

  it('strips direction-control characters from the label', () => {
    const parts = descriptionParts('see https://a.example/\u202Eevil');
    const found = parts.find(p => p.kind === 'link');
    expect(found && found.kind === 'link' ? found.label : '').toBe('a.example/evil');
  });

  it('handles a very long run of trailing punctuation without stalling', () => {
    const started = Date.now();
    const parts = descriptionParts(`https://a.example/${'.'.repeat(19_900)}x`);
    expect(parts.some(p => p.kind === 'link')).toBe(true);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('returns plain text when there is no URL', () => {
    expect(descriptionParts('just words')).toEqual([{ kind: 'text', text: 'just words' }]);
  });
});

describe('descriptionParagraphs', () => {
  it('splits on blank lines and drops empties', () => {
    expect(descriptionParagraphs('one\n\n\ntwo\nstill two\n\n')).toEqual(['one', 'two\nstill two']);
    expect(descriptionParagraphs(null)).toEqual([]);
  });
});
