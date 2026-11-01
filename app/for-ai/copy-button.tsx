'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';

const RESET_MS = 1600;

type CopyState = 'idle' | 'copied' | 'failed';

const VISIBLE: Record<CopyState, string> = {
  idle: 'Copy',
  copied: 'Copied ✓',
  failed: 'Copy failed',
};

export function CopyButton({ text, what }: { text: string; what: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const flash = (next: CopyState) => {
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), RESET_MS);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      flash('copied');
    } catch {
      flash('failed');
    }
  };

  return (
    <>
      <button
        type="button"
        className="fa-copy"
        data-state={state}
        onClick={copy}
        aria-label={state === 'idle' ? `Copy ${what}` : `${VISIBLE[state]}: ${what}`}
      >
        {state === 'idle' ? <Copy size={13} strokeWidth={1.75} aria-hidden="true" /> : null}
        <span>{VISIBLE[state]}</span>
      </button>
      <span className="pg-sr" role="status">{state === 'copied' ? `Copied ${what} to the clipboard` : ''}</span>
    </>
  );
}
