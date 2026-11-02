// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from 'vitest';

const calls: Array<{ input: string | string[]; model: string }> = [];
const ctor = vi.fn();

beforeAll(() => {
  process.env.NEARAI_API_KEY = 'test-key';
});

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation((opts: unknown) => {
    ctor(opts);
    return {
      embeddings: {
        create: vi.fn().mockImplementation(async (body: { input: string | string[]; model: string }) => {
          calls.push(body);
          const inputs = Array.isArray(body.input) ? body.input : [body.input];
          return { data: inputs.map((_, i) => ({ index: i, embedding: Array(1024).fill(i === 0 ? 0.1 : 0.2) })).reverse() };
        }),
      },
    };
  }),
}));

import { embedText, embedBatch, wellFormed, DIMENSIONS, DEFAULT_EMBED_MODEL } from '@/lib/embeddings';

describe('embedText', () => {
  it('asks NEAR AI Cloud for a query embedding with the query instruction', async () => {
    const result = await embedText('What is NEAR?');
    expect(result).toHaveLength(DIMENSIONS);
    expect(ctor).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'test-key', baseURL: 'https://cloud-api.near.ai/v1' }));
    const last = calls.at(-1)!;
    expect(last.model).toBe(DEFAULT_EMBED_MODEL);
    expect(last.input).toMatch(/^Instruct: .*\nQuery: What is NEAR\?$/);
  });
});

describe('embedBatch', () => {
  it('embeds passages as they are and keeps the input order', async () => {
    const result = await embedBatch(['text one', 'text two']);
    expect(calls.at(-1)!.input).toEqual(['text one', 'text two']);
    expect(result[0][0]).toBeCloseTo(0.1);
    expect(result[1][0]).toBeCloseTo(0.2);
  });

  it('returns empty array for empty input', async () => {
    expect(await embedBatch([])).toHaveLength(0);
  });
});

describe('wellFormed', () => {
  it('replaces half an emoji left by a chunk boundary and keeps whole ones', () => {
    const cut = 'gm \u{1F680}'.slice(0, -1);
    expect(wellFormed(cut)).toBe('gm \uD83D'.replace('\uD83D', '\uFFFD'));
    expect(wellFormed('\uDE80 tail')).toBe('\uFFFD tail');
    expect(wellFormed('ship \u{1F680} it')).toBe('ship \u{1F680} it');
  });

  it('is applied to every batch input', async () => {
    await embedBatch(['ok', 'x\uD83D']);
    expect(calls.at(-1)!.input).toEqual(['ok', 'x\uFFFD']);
  });
});
