import { describe, expect, it } from 'vitest';
import { EMPTY_STORE, parseStore, patchTurn, storable, titleFrom, withTurn, withoutConversation } from '@/app/ask/conversations';
import type { Turn } from '@/app/ask/types';

const answer = { answer: 'a [1]', truncated: false, sources: [], receipt: { model: 'm', signature_kind: 'provider_tee', signing_address: '0x', tcb_status: 'UpToDate', e2ee: true, verified_at: '2026-11-03T00:00:00Z', verify_url: 'https://cloud.near.ai/verify' }, db_anchor: null };
const done = (id: string, q: string, at: string): Turn => ({ id, question: q, askedAt: at, status: 'done', result: answer });

describe('ask conversations', () => {
  it('turns the single chat an earlier version kept into one conversation', () => {
    const legacy = JSON.stringify([done('t1', 'What does HSP-029 change?', '2026-11-03T10:00:00Z'), { id: 'x', status: 'pending' }]);
    const store = parseStore(null, legacy);
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0]).toMatchObject({ id: 't1', title: 'What does HSP-029 change?' });
    expect(store.activeId).toBe('t1');
  });

  it('survives storage it cannot read, and drops turns of the wrong shape', () => {
    expect(parseStore('{not json', null)).toEqual(EMPTY_STORE);
    const raw = JSON.stringify({ conversations: [{ id: 'c', title: 't', updatedAt: '2026-11-03', turns: [{ id: 'bad' }] }], activeId: 'c' });
    expect(parseStore(raw, null)).toEqual(EMPTY_STORE);
  });

  it('starts a conversation with the first question as its title and keeps follow-ups in it', () => {
    const pending: Turn = { id: 't1', question: 'Is near-sdk-js still safe to use?', askedAt: '2026-11-03T10:00:00Z', status: 'pending' };
    let store = withTurn(EMPTY_STORE, 'c1', pending, []);
    store = patchTurn(store, 'c1', 't1', { status: 'done', result: answer });
    const follow: Turn = { id: 't2', question: 'What instead?', askedAt: '2026-11-03T10:01:00Z', status: 'pending' };
    store = withTurn(store, 'c1', follow, store.conversations[0].turns);
    expect(store.activeId).toBe('c1');
    expect(store.conversations[0].title).toBe('Is near-sdk-js still safe to use?');
    expect(store.conversations[0].turns.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('writes back answered turns only, without pasted code', () => {
    const withCode: Turn = { ...done('t1', 'check this', '2026-11-03T10:00:00Z'), code: { text: 'secret code', filename: 'a.ts' } };
    const store = withTurn(EMPTY_STORE, 'c1', withCode, []);
    const pendingOnly = withTurn(store, 'c2', { id: 'p', question: 'q', askedAt: '2026-11-03T11:00:00Z', status: 'pending' }, []);
    const saved = storable(pendingOnly);
    expect(saved.conversations.map((c) => c.id)).toEqual(['c1']);
    expect(saved.conversations[0].turns[0].code).toEqual({ text: '', filename: 'a.ts' });
    expect(saved.activeId).toBeNull();
  });

  it('deletes a conversation and leaves a new chat open when it was the active one', () => {
    const store = withTurn(EMPTY_STORE, 'c1', done('t1', 'q', '2026-11-03T10:00:00Z'), []);
    expect(withoutConversation(store, 'c1')).toEqual(EMPTY_STORE);
  });

  it('cuts a long first question into a short title', () => {
    expect(titleFrom('a '.repeat(80)).length).toBeLessThanOrEqual(60);
  });
});
