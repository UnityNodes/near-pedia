'use client';

import { MessageSquare, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import type { Conversation } from './conversations';

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const days = Math.floor((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  return 'Earlier';
}

function groups(conversations: Conversation[]): Array<[string, Conversation[]]> {
  const out = new Map<string, Conversation[]>();
  for (const c of conversations) out.set(dayLabel(c.updatedAt), [...(out.get(dayLabel(c.updatedAt)) ?? []), c]);
  return [...out.entries()];
}

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  open: boolean;
  onClose: () => void;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
}

export function AskSidebar({ conversations, activeId, open, onClose, onSelect, onRemove }: Props) {
  const pick = (id: string | null) => { onSelect(id); onClose(); };
  return (
    <>
      <div className={`ak-scrim${open ? ' ak-scrim--on' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`ak-side${open ? ' ak-side--open' : ''}`} aria-label="Conversations">
        <div className="ak-side-top">
          <button type="button" className="ak-newchat" onClick={() => pick(null)}><Plus size={16} aria-hidden="true" />New chat</button>
          <button type="button" className="ak-icon ak-side-close" aria-label="Close the list" onClick={onClose}><X size={18} /></button>
        </div>
        <nav className="ak-side-list">
          {conversations.length === 0 && <p className="ak-side-empty">Your chats appear here. They stay in this browser only.</p>}
          {groups(conversations).map(([label, items]) => (
            <div key={label} className="ak-side-group">
              <p className="ak-side-label">{label}</p>
              {items.map((c) => (
                <div key={c.id} className={`ak-side-item${c.id === activeId ? ' ak-side-item--on' : ''}`}>
                  <button type="button" className="ak-side-open" onClick={() => pick(c.id)} aria-current={c.id === activeId ? 'true' : undefined}>
                    <MessageSquare size={14} aria-hidden="true" />
                    <span>{c.title}</span>
                  </button>
                  <button type="button" className="ak-side-del" aria-label={`Delete “${c.title}”`} onClick={() => onRemove(c.id)}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          ))}
        </nav>
        <details className="ak-side-about">
          <summary><ShieldCheck size={14} aria-hidden="true" />How answers are made</summary>
          <ul>
            <li>Your question, the last three exchanges and any pasted file are matched against this index and run through <code>check_code</code> on this server, in memory. Nothing you send is stored or logged there.</li>
            <li>The request leaves encrypted to the model&apos;s key, taken from its verified hardware attestation; NEAR AI&apos;s gateway relays it without reading it.</li>
            <li>An answer is shown only if its signature verifies. Each receipt opens NEAR AI&apos;s Verification Center.</li>
            <li>Chats are kept in this browser only. Each address can ask 30 questions an hour.</li>
          </ul>
        </details>
      </aside>
    </>
  );
}
