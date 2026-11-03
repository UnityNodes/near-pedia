'use client';

import { useEffect, useRef, useState } from 'react';
import { Menu, Plus, ShieldCheck } from 'lucide-react';
import { AskTurn, BotAvatar } from './ask-turn';
import { AskComposer } from './ask-composer';
import { AskSidebar } from './ask-sidebar';
import { useChatStore } from './use-chat-store';

const EXAMPLES = [
  { who: 'Code', q: 'Is near-sdk-js still safe to use?' },
  { who: 'Code', q: 'What replaces keyStores in near-api-js 7?' },
  { who: 'Governance', q: 'What does HSP-029 change, and did it pass?' },
  { who: 'Ecosystem', q: 'Was Rhea Finance hacked, and what happened?' },
];

function Welcome({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="ak-welcome">
      <BotAvatar />
      <h2>What do you want to know about NEAR?</h2>
      <p>Answers come only from NEARpedia&apos;s live sources, each with its date, and are signed by a model running in a TEE on NEAR AI Cloud.</p>
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

export function AskApp() {
  const chat = useChatStore();
  const [sideOpen, setSideOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const count = chat.turns.length;
  const lastStatus = chat.turns[count - 1]?.status;

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: count > 0 ? 'smooth' : 'auto' });
  }, [count, lastStatus, chat.active?.id]);

  return (
    <div className="ak-app">
      <AskSidebar
        conversations={chat.conversations}
        activeId={chat.active?.id ?? null}
        open={sideOpen}
        onClose={() => setSideOpen(false)}
        onSelect={chat.select}
        onRemove={chat.remove}
      />
      <section className="ak-main" aria-label="Chat">
        <header className="ak-bar">
          <button type="button" className="ak-icon ak-bar-menu" aria-label="Show your chats" onClick={() => setSideOpen(true)}><Menu size={18} /></button>
          <h2 className="ak-bar-title">{chat.active?.title ?? 'New chat'}</h2>
          <span className="ak-bar-badge"><ShieldCheck size={13} aria-hidden="true" />TEE-verified answers</span>
          <button type="button" className="ak-icon ak-bar-new" aria-label="New chat" disabled={!chat.active} onClick={() => chat.select(null)}><Plus size={18} /></button>
        </header>
        <div className="ak-scroll" ref={scroller}>
          <div className="ak-col">
            {count === 0
              ? <Welcome onPick={(q) => chat.send({ question: q })} />
              : <div className="ak-thread" role="log" aria-live="polite">{chat.turns.map((t) => <AskTurn key={t.id} turn={t} onRetry={chat.retry} />)}</div>}
          </div>
        </div>
        <div className="ak-dock">
          <div className="ak-col">
            <AskComposer busy={chat.busy} onSend={chat.send} />
          </div>
        </div>
      </section>
    </div>
  );
}
