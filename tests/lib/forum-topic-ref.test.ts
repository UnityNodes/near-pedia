import { describe, expect, it } from 'vitest';
import { forumTopicRef } from '@/lib/gov-forum';

describe('forumTopicRef', () => {
  it('reads a number and every gov.near.org URL shape', () => {
    expect(forumTopicRef(42644)).toEqual({ id: 42644, post: null });
    expect(forumTopicRef('42644')).toEqual({ id: 42644, post: null });
    expect(forumTopicRef('https://gov.near.org/t/42644')).toEqual({ id: 42644, post: null });
    expect(forumTopicRef('https://gov.near.org/t/42644/7')).toEqual({ id: 42644, post: 7 });
    expect(forumTopicRef('https://gov.near.org/t/hsp-029-a-1-6-target/42644')).toEqual({ id: 42644, post: null });
    expect(forumTopicRef('https://gov.near.org/t/hsp-029-a-1-6-target/42644/10?u=x')).toEqual({ id: 42644, post: 10 });
    expect(forumTopicRef('https://gov.near.org/t/hsp-029/42644#post_3')).toEqual({ id: 42644, post: null });
  });

  it('refuses what is not a topic', () => {
    expect(forumTopicRef('abc')).toBeNull();
    expect(forumTopicRef('https://gov.near.org/c/house-of-stake/158')).toBeNull();
    expect(forumTopicRef(1.5)).toBeNull();
  });
});
