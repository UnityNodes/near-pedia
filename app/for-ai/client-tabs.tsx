'use client';

import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { CopyButton } from './copy-button';
import type { ClientConfig } from './data';

export function ClientTabs({ configs }: { configs: ClientConfig[] }) {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (index: number) => {
    setActive(index);
    tabs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = configs.length - 1;
    const targets: Record<string, number> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(next);
  };

  const current = configs[active];

  return (
    <div className="fa-code" data-theme="dark">
      <div className="fa-code-bar">
        <div className="fa-tablist" role="tablist" aria-label="MCP client">
          {configs.map((config, i) => (
            <button
              key={config.tab}
              ref={el => { tabs.current[i] = el; }}
              type="button"
              role="tab"
              id={`fa-tab-${i}`}
              className="fa-tab"
              aria-selected={i === active}
              aria-controls={`fa-panel-${i}`}
              tabIndex={i === active ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={event => onKeyDown(event, i)}
            >
              {config.tab}
            </button>
          ))}
        </div>
        <CopyButton text={current.code} what={`${current.name} config`} />
      </div>

      {configs.map((config, i) => (
        <div
          key={config.tab}
          role="tabpanel"
          id={`fa-panel-${i}`}
          aria-labelledby={`fa-tab-${i}`}
          className="fa-panel"
          hidden={i !== active}
        >
          <div className="fa-code-meta">
            <span className="fa-code-name">{config.name}</span>
            <span className="fa-code-lang">{config.lang}</span>
          </div>
          <div className="fa-code-path">{config.path}</div>
          <pre tabIndex={0}><code>{config.code}</code></pre>
          {config.note ? (
            <p className="fa-code-note"><span className="fa-code-note-k">NOTE</span>{config.note}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
