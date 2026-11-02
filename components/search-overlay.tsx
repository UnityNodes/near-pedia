'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/app-context';
import { resultLink } from '@/lib/result-link';

interface Props {
  onClose: () => void;
}

interface PreviewItem {
  type: string;
  id: string;
  title: string;
  excerpt?: string;
  meta?: string;
  url: string;
}

const SUGGESTIONS = ['getting started', 'governance', 'node setup', 'NEAR', 'upgrade', 'ecosystem'];

const RECENT_KEY = 'nearpedia-recent-search';
const RECENT_MAX = 5;

function loadRecent(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string').slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

function saveRecent(query: string): void {
  if (typeof window === 'undefined') return;
  const q = query.trim();
  if (!q) return;
  try {
    const prev = loadRecent().filter(s => s.toLowerCase() !== q.toLowerCase());
    const next = [q, ...prev].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* localStorage full or disabled */ }
}

const TYPE_LABEL: Record<string, string> = {
  doc: 'DOC',
  discussion: 'FORUM',
  mail: 'MAIL',
  proposal: 'PROPOSAL',
  blog: 'BLOG',
  youtube: 'VIDEO',
  github: 'CODE',
};

export function SearchOverlay({ onClose }: Props) {
  const { t } = useApp();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const [popular, setPopular] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    setRecent(loadRecent());
    // Fetch popular searches (last 7 days, top 6) - best-effort,
    // silently falls through if the endpoint isn't available yet.
    const ctrl = new AbortController();
    fetch('/api/v1/searches/popular?window=7&limit=6', { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then((data: { items?: { query: string }[] } | null) => {
        if (data?.items) setPopular(data.items.map(i => i.query));
      })
      .catch(() => { /* offline, blocked, 404 - show static SUGGESTIONS instead */ });
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Debounced live preview via global REST API search
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setItems([]);
      setFocusIdx(-1);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/v1/search?q=${encodeURIComponent(trimmed)}&limit=6`, { signal: ctrl.signal });
        if (!r.ok) throw new Error(String(r.status));
        const data = await r.json() as { items: PreviewItem[] };
        setItems(data.items ?? []);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setItems([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  const submit = () => {
    const trimmed = q.trim();
    if (trimmed) {
      saveRecent(trimmed);
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
      onClose();
    }
  };

  const openItem = (item: PreviewItem) => {
    if (q.trim()) saveRecent(q.trim());
    const link = resultLink(item.url, window.location.host);
    if (link.internal) router.push(link.path);
    else window.open(link.href, '_blank', 'noopener,noreferrer');
    onClose();
  };

  const clearRecent = () => {
    if (typeof window === 'undefined') return;
    try { localStorage.removeItem(RECENT_KEY); } catch { /* noop */ }
    setRecent([]);
  };

  const onKeyNav = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (items.length === 0) {
      if (e.key === 'Enter') submit();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx(i => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx(i => Math.max(-1, i - 1));
    } else if (e.key === 'Enter') {
      if (focusIdx >= 0 && focusIdx < items.length) {
        openItem(items[focusIdx]);
      } else {
        submit();
      }
    }
  };

  return (
    <div className="search-overlay" onClick={onClose} role="presentation">
      <div className="search-modal" role="dialog" aria-modal="true" aria-label="Search" onClick={e => e.stopPropagation()}>
        <div className="search-modal-head">
          <span className="dot" />
          <span>{t.search_modal_title}</span>
          <span className="search-modal-keyhint" style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--mono)',
            fontSize: 'var(--text-2xs)',
            opacity: 0.6,
            letterSpacing: '0.06em',
          }}>
            <kbd className="search-modal-keyhint-full" style={{
              padding: '2px 6px',
              border: '1px solid var(--rule-soft)',
              borderRadius: 3,
              fontFamily: 'var(--mono)',
              fontSize: 'var(--text-2xs)',
              fontWeight: 600,
            }}>↑</kbd>
            <kbd className="search-modal-keyhint-full" style={{
              padding: '2px 6px',
              border: '1px solid var(--rule-soft)',
              borderRadius: 3,
              fontFamily: 'var(--mono)',
              fontSize: 'var(--text-2xs)',
              fontWeight: 600,
            }}>↓</kbd>
            <span className="search-modal-keyhint-full">navigate</span>
            <kbd className="search-modal-keyhint-full" style={{
              padding: '2px 6px',
              border: '1px solid var(--rule-soft)',
              borderRadius: 3,
              fontFamily: 'var(--mono)',
              fontSize: 'var(--text-2xs)',
              fontWeight: 600,
              marginLeft: 6,
            }}>↵</kbd>
            <span className="search-modal-keyhint-full">open</span>
            <kbd style={{
              padding: '2px 6px',
              border: '1px solid var(--rule-soft)',
              borderRadius: 3,
              fontFamily: 'var(--mono)',
              fontSize: 'var(--text-2xs)',
              fontWeight: 600,
              marginLeft: 6,
            }}>{t.search_esc}</kbd>
          </span>
        </div>
        <input
          ref={inputRef}
          className="search-modal-input"
          placeholder={t.search_placeholder}
          value={q}
          onChange={e => { setQ(e.target.value); setFocusIdx(-1); }}
          onKeyDown={onKeyNav}
        />
        <div className="search-modal-body">
          {!q && recent.length > 0 && (
            <div style={{ padding: '12px 18px 4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{
                  fontFamily: 'var(--mono)', fontSize: 'var(--text-2xs)', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.12em',
                  color: 'var(--fg-mute)',
                }}>
                  Recent
                </span>
                <button
                  onClick={clearRecent}
                  style={{
                    fontFamily: 'var(--mono)', fontSize: 'var(--text-2xs)',
                    background: 'none', border: 'none',
                    color: 'var(--fg-mute)', cursor: 'pointer',
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                  }}
                  aria-label="Clear recent searches"
                >
                  Clear
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} role="list">
                {recent.map(r => (
                  <button
                    key={r}
                    onClick={() => setQ(r)}
                    aria-label={`Reuse recent search: ${r}`}
                    role="listitem"
                    style={{
                      textAlign: 'left',
                      fontFamily: 'var(--mono)', fontSize: 13,
                      padding: '6px 10px',
                      background: 'transparent', border: 'none',
                      color: 'var(--fg)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}
                  >
                    <span aria-hidden="true" style={{ color: 'var(--fg-mute)', fontSize: 11 }}>↻</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!q && popular.length > 0 && (
            <div style={{ padding: '8px 18px 0' }}>
              <span style={{
                fontFamily: 'var(--mono)', fontSize: 'var(--text-2xs)', fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.12em',
                color: 'var(--fg-mute-text)', display: 'block', marginBottom: 6,
              }}>
                Popular · last 7 days
              </span>
              <div className="search-suggest-row" role="list" aria-label="Popular searches">
                {popular.map(s => (
                  <button
                    key={`tr-${s}`}
                    className="search-chip"
                    role="listitem"
                    aria-label={`Search for ${s}`}
                    onClick={() => setQ(s)}
                  >{`↗ ${s}`}</button>
                ))}
              </div>
            </div>
          )}

          {!q && (
            <div className="search-suggest-row" role="list" aria-label="Suggested searches">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  className="search-chip"
                  role="listitem"
                  aria-label={`Search for ${s}`}
                  onClick={() => setQ(s)}
                >{`// ${s}`}</button>
              ))}
            </div>
          )}

          {q && items.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {items.map((item, i) => (
                <div
                  key={`${item.type}-${item.id}-${i}`}
                  className="search-result"
                  onClick={() => openItem(item)}
                  onMouseEnter={() => setFocusIdx(i)}
                  style={{
                    cursor: 'pointer',
                    background: i === focusIdx ? 'var(--bg-2)' : 'transparent',
                  }}
                >
                  <span className="kind-pill">{TYPE_LABEL[item.type] ?? item.type.toUpperCase()}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontWeight: 600, fontSize: 13,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{item.title}</div>
                    {(item.excerpt || item.meta) && (
                      <div style={{
                        fontSize: 11, color: 'var(--fg-mute)', marginTop: 3,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {item.excerpt || item.meta}
                      </div>
                    )}
                  </div>
                  <span style={{ color: 'var(--accent-text)', fontSize: 12 }}>→</span>
                </div>
              ))}
              <div
                className="search-result"
                onClick={submit}
                style={{ cursor: 'pointer', opacity: 0.85 }}
              >
                <span className="kind-pill" style={{ background: 'var(--accent)', color: 'var(--on-accent)', border: 'none' }}>ALL</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {t.search_see_all} &ldquo;{q}&rdquo;
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--fg-mute)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {t.search_enter}
                  </div>
                </div>
                <span style={{ color: 'var(--accent-text)' }}>↵</span>
              </div>
            </div>
          )}

          {q && items.length === 0 && !loading && q.trim().length >= 2 && (
            <div
              className="search-result"
              onClick={submit}
              style={{ cursor: 'pointer' }}
            >
              <span className="kind-pill">ALL</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>&ldquo;{q}&rdquo;</div>
                <div style={{ fontSize: 11, color: 'var(--fg-mute)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>
                  {t.search_no_matches} · {t.search_enter}
                </div>
              </div>
              <span style={{ color: 'var(--accent-text)' }}>→</span>
            </div>
          )}

          {q && loading && items.length === 0 && (
            <div style={{ padding: '14px 18px', fontSize: 12, color: 'var(--fg-mute)', fontFamily: 'var(--mono)' }}>
              {t.search_searching}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
