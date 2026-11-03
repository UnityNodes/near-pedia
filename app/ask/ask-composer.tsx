'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { ArrowUp, FileCode2, X } from 'lucide-react';

const MAX_QUESTION = 2000;
const MAX_CODE = 20_000;
const MAX_ROWS_PX = 200;

export interface Draft { question: string; code?: { text: string; filename?: string } }

export function AskComposer({ busy, onSend }: { busy: boolean; onSend: (draft: Draft) => void }) {
  const ids = { q: useId(), code: useId(), file: useId() };
  const [question, setQuestion] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState('');
  const [filename, setFilename] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
  }, [question]);

  function send(e?: FormEvent) {
    e?.preventDefault();
    if (busy || !question.trim()) return;
    const attached = showCode && code.trim() ? { text: code, filename: filename.trim() || undefined } : undefined;
    onSend({ question: question.trim(), code: attached });
    setQuestion('');
    setCode('');
    setFilename('');
    setShowCode(false);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) send(e);
  }

  return (
    <form className="ak-composer" onSubmit={send}>
      {showCode && (
        <div className="ak-codebox">
          <div className="ak-codebox-head">
            <label htmlFor={ids.file} className="pg-sr">File name</label>
            <input id={ids.file} value={filename} maxLength={200} onChange={(e) => setFilename(e.target.value)} placeholder="file name, e.g. src/lib.rs" />
            <span className="ak-count">{code.length.toLocaleString()} / {MAX_CODE.toLocaleString()}</span>
            <button type="button" className="ak-icon" aria-label="Remove the code" onClick={() => { setShowCode(false); setCode(''); setFilename(''); }}><X size={15} /></button>
          </div>
          <label htmlFor={ids.code} className="pg-sr">Code to check</label>
          <textarea id={ids.code} rows={7} maxLength={MAX_CODE} value={code} spellCheck={false} onChange={(e) => setCode(e.target.value)}
            placeholder="Paste one contract, script, package.json or Cargo.toml: check_code runs on it before the model answers" />
        </div>
      )}
      <div className="ak-inputrow">
        <button type="button" className={`ak-icon${showCode ? ' ak-icon--on' : ''}`} aria-pressed={showCode} aria-label="Attach code to check" title="Attach code to check" onClick={() => setShowCode((v) => !v)}>
          <FileCode2 size={18} />
        </button>
        <label htmlFor={ids.q} className="pg-sr">Your question</label>
        <textarea id={ids.q} ref={box} rows={1} maxLength={MAX_QUESTION} value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={onKey}
          placeholder="Ask anything about NEAR" />
        <button type="submit" className="ak-send" disabled={busy || !question.trim()} aria-label="Send">
          <ArrowUp size={18} />
        </button>
      </div>
      <p className="ak-hint">Answers come only from the cited sources. Check them before you rely on one.</p>
    </form>
  );
}
