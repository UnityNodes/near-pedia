'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { EMPTY_STORE, parseStore, patchTurn, storable, withTurn, withoutConversation, type ChatStore } from './conversations';
import type { Answer, Turn } from './types';
import type { Draft } from './ask-composer';

const STORAGE_KEY = 'nearpedia-ask-chats-v2';
const LEGACY_KEY = 'nearpedia-ask-chat-v1';
const HISTORY_TURNS = 3;

const noopSubscribe = () => () => {};

function readStore(): ChatStore {
  try {
    return parseStore(localStorage.getItem(STORAGE_KEY), localStorage.getItem(LEGACY_KEY));
  } catch {
    return EMPTY_STORE;
  }
}

function writeStore(store: ChatStore) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storable(store)));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    return;
  }
}

function errorFor(status: number): string {
  if (status === 429) return 'You have asked 30 questions this hour from this address. Try again a little later.';
  if (status === 502 || status === 504 || (status >= 520 && status <= 524)) return 'NEAR AI did not answer this time. Try again in a moment.';
  if (status === 503) return 'Ask is busy or paused right now. Try again in a minute.';
  return `Something went wrong (${status}). Try again.`;
}

async function requestAnswer(draft: Draft, earlier: Turn[]): Promise<{ result?: Answer; error?: string }> {
  const history = earlier.filter((t) => t.status === 'done' && t.result).slice(-HISTORY_TURNS)
    .map((t) => ({ question: t.question, answer: t.result!.answer }));
  try {
    const res = await fetch('/api/v1/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: draft.question, history, ...(draft.code ? { code: draft.code.text, filename: draft.code.filename } : {}) }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { error: body?.error ?? errorFor(res.status) };
    return { result: body as Answer };
  } catch {
    return { error: 'Network error. Check your connection and try again.' };
  }
}

const newId = () => crypto.randomUUID().slice(0, 8);

export function useChatStore() {
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const stored = useMemo(() => (hydrated ? readStore() : EMPTY_STORE), [hydrated]);
  const [own, setOwn] = useState<ChatStore | null>(null);
  const store = own ?? stored;
  const active = store.conversations.find((c) => c.id === store.activeId) ?? null;
  const turns = active?.turns ?? [];
  const busy = turns.some((t) => t.status === 'pending');

  useEffect(() => {
    if (own) writeStore(own);
  }, [own]);

  const update = useCallback((fn: (s: ChatStore) => ChatStore) => setOwn((s) => fn(s ?? stored)), [stored]);

  const ask = useCallback(async (draft: Draft, convId: string | null, earlier: Turn[]) => {
    const id = convId ?? newId();
    const turn: Turn = { id: newId(), question: draft.question, code: draft.code, askedAt: new Date().toISOString(), status: 'pending' };
    update((s) => withTurn(s, id, turn, earlier));
    const { result, error } = await requestAnswer(draft, earlier);
    update((s) => patchTurn(s, id, turn.id, { status: result ? 'done' : 'error', result, error }));
  }, [update]);

  return {
    hydrated,
    conversations: store.conversations,
    active,
    turns,
    busy,
    send: (draft: Draft) => void ask(draft, active?.id ?? null, turns),
    retry: (failed: Turn) => void ask({ question: failed.question, code: failed.code }, active?.id ?? null, turns.filter((t) => t.id !== failed.id)),
    select: (id: string | null) => update((s) => ({ ...s, activeId: id })),
    remove: (id: string) => update((s) => withoutConversation(s, id)),
  };
}
