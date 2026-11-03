'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { AskTurn } from './ask-turn';
import { AskComposer, type Draft } from './ask-composer';
import type { Answer, Turn } from './types';

const STORAGE_KEY = 'nearpedia-ask-chat-v1';
const KEEP_TURNS = 20;
const HISTORY_TURNS = 3;

const EXAMPLES = [
  { who: 'Developers', q: 'Is near-sdk-js still safe to use?' },
  { who: 'Developers', q: 'What replaces keyStores in near-api-js 7?' },
  { who: 'Researchers', q: 'What does HSP-029 change, and did it pass?' },
  { who: 'Researchers', q: 'Was Rhea Finance hacked, and what happened?' },
];

const noopSubscribe = () => () => {};

function isStoredTurn(t: unknown): t is Turn {
  const turn = t as Turn | null;
  return !!turn && typeof turn.id === 'string' && typeof turn.question === 'string' && turn.status === 'done'
    && typeof turn.result?.answer === 'string' && Array.isArray(turn.result.sources) && typeof turn.result.receipt?.verify_url === 'string';
}

function loadTurns(): Turn[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isStoredTurn) : [];
  } catch {
    return [];
  }
}

function saveTurns(turns: Turn[]) {
  const kept = turns.filter((t) => t.status === 'done').slice(-KEEP_TURNS)
    .map((t) => (t.code ? { ...t, code: { text: '', filename: t.code.filename } } : t));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      return;
    }
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
    return { error: 'Network error. Try again.' };
  }
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="ak-empty">
      <p className="ak-empty-title">Try one of these, or ask your own</p>
      <div className="ak-examples">
        {EXAMPLES.map((e) => (
          <button key={e.q} type="button" className="ak-example" onClick={() => onPick(e.q)}>
            <span className="ak-example-who">{e.who}</span>
            <span>{e.q}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function AskChat() {
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const stored = useMemo(() => (hydrated ? loadTurns() : []), [hydrated]);
  const [own, setTurns] = useState<Turn[] | null>(null);
  const turns = own ?? stored;
  const end = useRef<HTMLDivElement>(null);
  const busy = turns.some((t) => t.status === 'pending');

  useEffect(() => {
    if (own) saveTurns(own);
  }, [own]);

  const ask = useCallback(async (draft: Draft, earlier: Turn[]) => {
    const turn: Turn = { id: crypto.randomUUID().slice(0, 8), question: draft.question, code: draft.code, askedAt: new Date().toISOString(), status: 'pending' };
    setTurns([...earlier, turn]);
    requestAnimationFrame(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
    const { result, error } = await requestAnswer(draft, earlier);
    setTurns((all) => (all ?? []).map((t) => (t.id === turn.id ? { ...t, status: result ? 'done' : 'error', result, error } : t)));
  }, []);

  const retry = useCallback((failed: Turn) => {
    const earlier = turns.filter((t) => t.id !== failed.id);
    void ask({ question: failed.question, code: failed.code }, earlier);
  }, [turns, ask]);

  return (
    <section className="ak-chat" aria-label="Conversation">
      {turns.length > 0 && (
        <div className="ak-toolbar">
          <span>{turns.length} {turns.length === 1 ? 'question' : 'questions'} in this chat, kept in this browser only</span>
          <button type="button" className="ak-ghost" disabled={busy} onClick={() => setTurns([])}><MessageSquarePlus size={14} aria-hidden="true" />New chat</button>
        </div>
      )}
      <div className="ak-thread" role="log" aria-live="polite">
        {turns.length === 0 ? <EmptyState onPick={(q) => void ask({ question: q }, turns)} /> : turns.map((t) => <AskTurn key={t.id} turn={t} onRetry={retry} />)}
        <div ref={end} />
      </div>
      <AskComposer busy={busy} onSend={(d) => void ask(d, turns)} />
    </section>
  );
}
