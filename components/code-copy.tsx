'use client';

import { useEffect } from 'react';

const LABEL_COPY = 'Copy';
const LABEL_DONE = 'Copied';
const LABEL_FAIL = 'Error';
const RESET_MS = 2000;

export function CodeCopy({ selector }: { selector: string }) {
  useEffect(() => {
    const container = document.querySelector(selector);
    if (!container) return;

    const timers: number[] = [];

    container.querySelectorAll('pre').forEach(pre => {
      if (pre.parentElement?.dataset.codeWrap) return;

      const wrap = document.createElement('div');
      wrap.dataset.codeWrap = '1';
      wrap.className = 'code-block-wrap';

      const bar = document.createElement('div');
      bar.className = 'code-block-bar';

      const codeEl = pre.querySelector('code');
      const langMatch = codeEl?.className?.match(/lang-(\w+)|language-(\w+)/);
      const lang = langMatch?.[1] ?? langMatch?.[2] ?? 'code';

      const label = document.createElement('span');
      label.className = 'code-block-lang';
      label.textContent = lang;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy-btn';
      btn.textContent = LABEL_COPY;

      btn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(pre.textContent ?? '');
          btn.textContent = LABEL_DONE;
          btn.classList.add('copied');
        } catch {
          btn.textContent = LABEL_FAIL;
        }
        timers.push(window.setTimeout(() => {
          btn.textContent = LABEL_COPY;
          btn.classList.remove('copied');
        }, RESET_MS));
      };

      pre.classList.add('rd-code');

      bar.appendChild(label);
      bar.appendChild(btn);
      pre.parentNode?.insertBefore(wrap, pre);
      wrap.appendChild(bar);
      wrap.appendChild(pre);
    });

    return () => timers.forEach(t => window.clearTimeout(t));
  }, [selector]);

  return null;
}
