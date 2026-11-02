import { describe, expect, it } from 'vitest';
import { isSpamTopic } from '@/lib/refusals';

describe('isSpamTopic', () => {
  it('passes a NEAR project that has casino in its name', () => {
    expect(isSpamTopic({ id: 4198, title: 'Introducing rekt.casino - a game of skill' })).toBe(false);
  });

  it('catches what spam sells', () => {
    expect(isSpamTopic({ id: 1, title: 'Best online casino bonus 2026' })).toBe(true);
    expect(isSpamTopic({ id: 2, title: 'Cheap payday loans fast' })).toBe(true);
    expect(isSpamTopic({ id: 3, title: 'Casino free spins today' })).toBe(true);
  });
});
