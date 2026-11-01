// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key';
});

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: {
      create: vi.fn().mockImplementation(async ({ input }: { input: string | string[] }) => {
        const inputs = Array.isArray(input) ? input : [input];
        return {
          data: inputs.map((_, i) => ({ embedding: Array(1536).fill(i === 0 ? 0.1 : 0.2) })),
        };
      }),
    },
  })),
}));

import { embedText, embedBatch } from '@/lib/embeddings';

describe('embedText', () => {
  it('returns array of length 1536', async () => {
    const result = await embedText('What is NEAR?');
    expect(result).toHaveLength(1536);
    expect(result[0]).toBeCloseTo(0.1);
  });
});

describe('embedBatch', () => {
  it('returns array of arrays', async () => {
    const result = await embedBatch(['text one', 'text two']);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(1536);
  });

  it('returns empty array for empty input', async () => {
    const result = await embedBatch([]);
    expect(result).toHaveLength(0);
  });
});
