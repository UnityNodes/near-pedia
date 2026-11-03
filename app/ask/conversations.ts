import type { Turn } from './types';

export interface Conversation { id: string; title: string; updatedAt: string; turns: Turn[] }
export interface ChatStore { conversations: Conversation[]; activeId: string | null }

export const EMPTY_STORE: ChatStore = { conversations: [], activeId: null };
const KEEP_CONVERSATIONS = 30;
const KEEP_TURNS = 20;
const TITLE_CHARS = 60;

export function titleFrom(question: string): string {
  const line = question.replace(/\s+/g, ' ').trim();
  return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1)}…` : line;
}

export function isStoredTurn(t: unknown): t is Turn {
  const turn = t as Turn | null;
  return !!turn && typeof turn.id === 'string' && typeof turn.question === 'string' && turn.status === 'done'
    && typeof turn.result?.answer === 'string' && Array.isArray(turn.result.sources) && typeof turn.result.receipt?.verify_url === 'string';
}

function isConversation(c: unknown): c is Conversation {
  const conv = c as Conversation | null;
  return !!conv && typeof conv.id === 'string' && typeof conv.title === 'string' && typeof conv.updatedAt === 'string' && Array.isArray(conv.turns);
}

export function parseStore(current: string | null, legacy: string | null): ChatStore {
  try {
    if (current) {
      const raw = JSON.parse(current) as { conversations?: unknown; activeId?: unknown };
      const conversations = (Array.isArray(raw.conversations) ? raw.conversations : []).filter(isConversation)
        .map((c) => ({ ...c, turns: c.turns.filter(isStoredTurn) })).filter((c) => c.turns.length > 0);
      const activeId = typeof raw.activeId === 'string' && conversations.some((c) => c.id === raw.activeId) ? raw.activeId : null;
      return { conversations, activeId };
    }
    const turns = legacy ? (JSON.parse(legacy) as unknown[]).filter(isStoredTurn) : [];
    if (turns.length === 0) return EMPTY_STORE;
    const conv = { id: turns[0].id, title: titleFrom(turns[0].question), updatedAt: turns[turns.length - 1].askedAt, turns };
    return { conversations: [conv], activeId: conv.id };
  } catch {
    return EMPTY_STORE;
  }
}

export function storable(store: ChatStore): ChatStore {
  const conversations = store.conversations
    .map((c) => ({ ...c, turns: c.turns.filter((t) => t.status === 'done').slice(-KEEP_TURNS).map((t) => (t.code ? { ...t, code: { text: '', filename: t.code.filename } } : t)) }))
    .filter((c) => c.turns.length > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, KEEP_CONVERSATIONS);
  return { conversations, activeId: conversations.some((c) => c.id === store.activeId) ? store.activeId : null };
}

export function withTurn(store: ChatStore, convId: string, turn: Turn, earlier: Turn[]): ChatStore {
  const existing = store.conversations.find((c) => c.id === convId);
  const conv: Conversation = existing
    ? { ...existing, updatedAt: turn.askedAt, turns: [...earlier, turn] }
    : { id: convId, title: titleFrom(turn.question), updatedAt: turn.askedAt, turns: [turn] };
  return { conversations: [conv, ...store.conversations.filter((c) => c.id !== convId)], activeId: convId };
}

export function patchTurn(store: ChatStore, convId: string, turnId: string, patch: Partial<Turn>): ChatStore {
  return {
    ...store,
    conversations: store.conversations.map((c) => (c.id !== convId ? c : { ...c, turns: c.turns.map((t) => (t.id === turnId ? { ...t, ...patch } : t)) })),
  };
}

export function withoutConversation(store: ChatStore, convId: string): ChatStore {
  return { conversations: store.conversations.filter((c) => c.id !== convId), activeId: store.activeId === convId ? null : store.activeId };
}
