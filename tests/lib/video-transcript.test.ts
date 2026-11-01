import { describe, it, expect } from 'vitest';
import {
  cleanSegmentText, decodeSegments, encodeSegments, excerptAround, findPassages, fitSegments, formatClock, groupSegments,
  parseClock, parsePanel, plainParagraphs, queryTokens, renderTimed, segmentsText, shrinksStored, timeLink,
} from '@/lib/video-transcript';
import type { TranscriptSegment } from '@/lib/video-transcript';
import { TRUNCATION_MARKER } from '@/lib/cap-text';

function panel(items: Array<{ text: string; at: string }>): unknown {
  return {
    actions: [{
      body: {
        segments: items.map(i => ({ transcriptSegmentViewModel: { simpleText: i.text, timestamp: i.at, style: 'X' } })),
      },
    }],
  };
}

describe('clock', () => {
  it('parses minutes and hours', () => {
    expect(parseClock('0:05')).toBe(5);
    expect(parseClock('15:30')).toBe(930);
    expect(parseClock('1:02:03')).toBe(3723);
  });

  it('rejects text that is not a clock', () => {
    expect(parseClock('soon')).toBeNull();
    expect(parseClock('')).toBeNull();
    expect(parseClock(null)).toBeNull();
    expect(parseClock('1:2:3:4')).toBeNull();
  });

  it('formats back to the same shape', () => {
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(930)).toBe('15:30');
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatClock(-4)).toBe('0:00');
  });
});

describe('cleanSegmentText', () => {
  it('drops caption noise tags and the foreign marker', () => {
    expect(cleanSegmentText('[Music]')).toBe('');
    expect(cleanSegmentText('foreign')).toBe('');
    expect(cleanSegmentText('hello [Applause] world')).toBe('hello world');
  });

  it('keeps real speech containing the word foreign', () => {
    expect(cleanSegmentText('foreign exchange settles faster')).toBe('foreign exchange settles faster');
  });
});

describe('parsePanel', () => {
  it('reads timestamps and text in order and skips noise', () => {
    const segs = parsePanel(panel([
      { text: '[Music]', at: '0:00' },
      { text: 'Hey everybody', at: '0:05' },
      { text: 'welcome to the session', at: '0:12' },
    ]));
    expect(segs).toEqual([
      { start: 5, text: 'Hey everybody' },
      { start: 12, text: 'welcome to the session' },
    ]);
  });

  it('keeps the previous start when a timestamp is missing', () => {
    const segs = parsePanel({ a: [
      { transcriptSegmentViewModel: { simpleText: 'one', timestamp: '0:07' } },
      { transcriptSegmentViewModel: { simpleText: 'two' } },
    ] });
    expect(segs.map(s => s.start)).toEqual([7, 7]);
  });

  it('returns nothing for an empty or unrelated panel', () => {
    expect(parsePanel({ responseContext: {} })).toEqual([]);
    expect(parsePanel(null)).toEqual([]);
  });
});

describe('storage round trip', () => {
  const segs: TranscriptSegment[] = [{ start: 5, text: 'Hey "quoted" text' }, { start: 12, text: 'two' }];

  it('encodes compactly and decodes to the same segments', () => {
    const json = encodeSegments(segs);
    expect(json.startsWith('[[5,')).toBe(true);
    expect(decodeSegments(json)).toEqual(segs);
  });

  it('decodes malformed input to an empty list', () => {
    expect(decodeSegments(null)).toEqual([]);
    expect(decodeSegments('not json')).toEqual([]);
    expect(decodeSegments('{"a":1}')).toEqual([]);
    expect(decodeSegments('[[1,"a"],[2]]')).toEqual([]);
  });
});

describe('fitSegments', () => {
  const segs: TranscriptSegment[] = Array.from({ length: 40 }, (_, i) => ({ start: i * 5, text: `segment number ${i} with some words` }));

  it('keeps everything under the cap', () => {
    const fit = fitSegments(segs, 100_000);
    expect(fit.truncated).toBe(false);
    expect(fit.segments).toHaveLength(40);
    expect(fit.text).toBe(segmentsText(segs));
  });

  it('cuts text and segments together and marks the cut', () => {
    const fit = fitSegments(segs, 400);
    expect(fit.truncated).toBe(true);
    expect(fit.text.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(fit.segments.length).toBeLessThan(40);
    const kept = segmentsText(fit.segments);
    expect(fit.text.startsWith(kept)).toBe(true);
  });
});

describe('groupSegments', () => {
  it('merges short segments into readable blocks that keep their first start', () => {
    const segs: TranscriptSegment[] = Array.from({ length: 30 }, (_, i) => ({ start: i * 4, text: i % 5 === 4 ? `Sentence ${i} ends here.` : `words ${i} continue` }));
    const blocks = groupSegments(segs);
    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks[0].start).toBe(0);
    expect(blocks.map(b => b.text).join(' ')).toBe(segmentsText(segs));
  });

  it('starts a new block after a long gap', () => {
    const blocks = groupSegments([{ start: 0, text: 'a' }, { start: 500, text: 'b' }]);
    expect(blocks).toEqual([{ start: 0, text: 'a' }, { start: 500, text: 'b' }]);
  });

  it('returns nothing for no segments', () => {
    expect(groupSegments([])).toEqual([]);
  });
});

describe('renderTimed and timeLink', () => {
  it('prefixes every block with its clock', () => {
    expect(renderTimed([{ start: 5, text: 'a' }, { start: 3723, text: 'b' }])).toBe('[0:05] a\n[1:02:03] b');
  });

  it('builds a YouTube deep link in whole seconds', () => {
    expect(timeLink('abc12345678', 754.9)).toBe('https://www.youtube.com/watch?v=abc12345678&t=754s');
  });
});

describe('findPassages', () => {
  const filler = Array.from({ length: 60 }, (_, i): TranscriptSegment => ({ start: i * 10, text: `Atlas is discussed in general terms here ${i}` }));
  const segs: TranscriptSegment[] = [
    ...filler,
    { start: 600, text: 'and then the Showcase format' },
    { start: 610, text: 'explains how Atlas Showcase episodes work' },
    ...filler.map(s => ({ start: s.start + 700, text: s.text })),
  ];

  it('prefers the window holding every token over the first common word', () => {
    const [hit] = findPassages(segs, 'Atlas Showcase', 1);
    expect(hit.start).toBeGreaterThanOrEqual(590);
    expect(hit.start).toBeLessThanOrEqual(610);
    expect(hit.text.toLowerCase()).toContain('showcase');
  });

  it('returns passages in playback order and never overlapping', () => {
    const many = findPassages(segs, 'Atlas', 4);
    expect(many.length).toBeLessThanOrEqual(4);
    const starts = many.map(m => m.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(new Set(starts).size).toBe(starts.length);
  });

  it('returns nothing when the query is absent', () => {
    expect(findPassages(segs, 'zzzqqq')).toEqual([]);
    expect(findPassages([], 'atlas')).toEqual([]);
  });
});

describe('findPassages matches words, not fragments', () => {
  const segs: TranscriptSegment[] = [
    { start: 0, text: 'and the participants transact on open rails' },
    { start: 10, text: 'each of them runs a validator node on the network' },
    { start: 20, text: 'we reviewed CIP 103 and how wallets use it' },
    { start: 30, text: 'it ran successfully for a while' },
  ];

  it('does not find CIP inside participants', () => {
    const [hit] = findPassages(segs, 'CIP', 1);
    expect(hit.text).toContain('CIP 103');
  });

  it('does not find cc inside successfully', () => {
    expect(findPassages(segs, 'cc')).toEqual([]);
  });

  it('treats a plural query as its singular form', () => {
    const [hit] = findPassages(segs, 'validators', 1);
    expect(hit.text).toContain('validator node');
  });

  it('centres an excerpt on the word, not on a fragment of another word', () => {
    const text = `${'participants '.repeat(20)}and then CIP 103 arrives ${'later words '.repeat(20)}`;
    expect(excerptAround(text, ['cip'], 80)).toContain('CIP 103');
  });
});

describe('plainParagraphs', () => {
  it('splits a long run with no punctuation at word boundaries', () => {
    const run = Array.from({ length: 3000 }, (_, i) => `w${i}`).join(' ');
    const parts = plainParagraphs(run, 700);
    expect(parts.length).toBeGreaterThan(5);
    expect(Math.max(...parts.map(p => p.length))).toBeLessThanOrEqual(700);
    expect(parts.join(' ')).toBe(run);
  });
});

describe('shrinksStored', () => {
  it('flags a replacement much shorter than what is stored, ignoring noise tags in the old text', () => {
    const old = `${'speech words here '.repeat(100)}${'[Music] '.repeat(50)}`;
    expect(shrinksStored(old, 'speech words here '.repeat(20))).toBe(true);
    expect(shrinksStored(old, 'speech words here '.repeat(95))).toBe(false);
    expect(shrinksStored(null, 'anything')).toBe(false);
  });
});

describe('query limits', () => {
  it('keeps at most a dozen distinct tokens and ignores the rest of a huge query', () => {
    const query = Array.from({ length: 5000 }, (_, i) => `tok${i}`).join(' ');
    expect(queryTokens(query).length).toBeLessThanOrEqual(12);
  });

  it('answers a huge query over a long transcript quickly', () => {
    const segs: TranscriptSegment[] = Array.from({ length: 20_000 }, (_, i) => ({ start: i, text: `word${i} atlas` }));
    const query = `atlas ${Array.from({ length: 22_000 }, (_, i) => `t${i}x`).join(' ')}`;
    const started = Date.now();
    findPassages(segs, query, 1);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe('queryTokens', () => {
  it('lower-cases, splits on punctuation and drops one-letter pieces', () => {
    expect(queryTokens('Atlas, Nova & a CIP-100')).toEqual(['atlas', 'nova', 'cip', '100']);
  });
});

describe('excerptAround', () => {
  const text = 'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega and then a validator joins the network after another long run of ordinary words that carry on and on';

  it('keeps short text whole', () => {
    expect(excerptAround('short text', ['text'])).toBe('short text');
  });

  it('centres on the first match, cuts on word boundaries and marks both cuts', () => {
    const out = excerptAround(text, ['validator'], 80);
    expect(out).toContain('validator');
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(84);
    expect(out.replace(/…/g, '').trim().split(' ').every(w => text.includes(w))).toBe(true);
  });

  it('shows the start when the match is early or absent', () => {
    expect(excerptAround(text, ['alpha'], 60).startsWith('Alpha')).toBe(true);
    expect(excerptAround(text, ['zzz'], 60).startsWith('Alpha')).toBe(true);
  });
});
