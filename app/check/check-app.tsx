'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUpRight, FileCode2, RotateCcw } from 'lucide-react';
import type { CheckResult, Finding, Severity } from '@/lib/check-code';
import type { Language } from '@/lib/code-scan';
import { signalLabel } from '../deprecations/signal-labels';

const ENDPOINT = '/api/v1/check-code';

const LANGUAGE_OPTIONS: { value: '' | Language; label: string }[] = [
  { value: '', label: 'Detect from name or content' },
  { value: 'js', label: 'JavaScript / TypeScript' },
  { value: 'rust', label: 'Rust' },
  { value: 'package-json', label: 'package.json' },
  { value: 'cargo', label: 'Cargo.toml' },
];

const SEVERITY_LABEL: Record<Severity, string> = { error: 'Error', warning: 'Warning', info: 'Info' };
const SEVERITY_TONE: Record<Severity, string> = { error: 'bad', warning: 'warn', info: 'info' };
const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info'];

type State =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; result: CheckResult; checked: string }
  | { kind: 'failed'; message: string };

interface Props {
  exampleCode: string;
  exampleFilename: string;
  maxChars: number;
}

async function runCheck(code: string, filename: string, language: '' | Language): Promise<CheckResult> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, filename: filename || undefined, language: language || undefined }),
  });
  const body = await res.json().catch(() => null) as (CheckResult & { error?: string }) | null;
  if (!res.ok || !body) {
    const reason = body?.error ?? `the server answered ${res.status}`;
    throw new Error(res.status === 429 ? `Too many checks from this address: ${reason}` : reason);
  }
  return body;
}

function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function FindingCard({ f }: { f: Finding }) {
  const replacementHref = f.entry?.replacement_url ? safeHref(f.entry.replacement_url) : null;
  return (
    <li className="ck-finding" data-severity={f.severity}>
      <div className="pg-row-top">
        <span className="pg-tag" data-tone={SEVERITY_TONE[f.severity]}>{SEVERITY_LABEL[f.severity]}</span>
        <span className="pg-row-meta">line {f.line} · {f.via} · {f.matched}</span>
      </div>
      <pre className="ck-line"><code><span className="ck-ln" aria-hidden="true">{f.line}</span>{f.code}</code></pre>
      {f.entry ? (
        <>
          <div className="pg-row-title">
            <Link href={`/deprecations/${encodeURIComponent(f.entry.id)}`} className="ck-entry">{f.entry.title}</Link>
            <span className="ck-status"> is {f.entry.status.replace('_', ' ')}</span>
          </div>
          <p className="ck-summary">{f.entry.summary}</p>
          {f.entry.replacement && (
            <p className="ck-use">
              <span className="ck-use-k">Use instead</span>
              {replacementHref
                ? <a href={replacementHref} target="_blank" rel="noopener noreferrer">{f.entry.replacement}<ArrowUpRight size={13} aria-hidden="true" /></a>
                : <span>{f.entry.replacement}</span>}
            </p>
          )}
        </>
      ) : (
        <p className="ck-summary">{f.message}</p>
      )}
      {f.live && <p className="ck-note">{f.live}</p>}
      {f.upstream && <p className="ck-note">The publisher wrote: &ldquo;{f.upstream}&rdquo;</p>}
      {f.sources.length > 0 && (
        <ul className="ck-sources" aria-label="Sources">
          {f.sources.map((s, i) => {
            const href = safeHref(s.url);
            const text = <>{signalLabel(s.signal)} · {hostOf(s.url)}{s.date ? ` · ${s.date.slice(0, 10)}` : ''}</>;
            return (
              <li key={`${s.url}-${s.signal}-${i}`}>
                {href ? <a href={href} target="_blank" rel="noopener noreferrer">{text}<ArrowUpRight size={12} aria-hidden="true" /><span className="pg-sr"> (opens in a new tab)</span></a> : text}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function Results({ result, checked }: { result: CheckResult; checked: string }) {
  const counts = SEVERITY_ORDER.map((s) => [s, result.findings.filter((f) => f.severity === s).length] as const).filter(([, n]) => n > 0);
  return (
    <section className="ck-results" aria-labelledby="ck-results-h" aria-live="polite">
      <div className="ck-results-head">
        <h2 id="ck-results-h" className="ck-h2">
          {result.findings.length === 0 ? 'Nothing stale found' : `${result.findings.length} finding${result.findings.length === 1 ? '' : 's'} in ${checked}`}
        </h2>
        <div className="pg-chips">
          {counts.map(([s, n]) => <span key={s} className="pg-tag" data-tone={SEVERITY_TONE[s]}>{n} {SEVERITY_LABEL[s].toLowerCase()}</span>)}
          <span className="pg-tag">read as {result.language}</span>
        </div>
      </div>
      {result.findings.length > 0 && (
        <ol className="ck-list">
          {result.findings.map((f, i) => <FindingCard key={`${f.line}-${f.matched}-${i}`} f={f} />)}
        </ol>
      )}
      <p className="ck-basis">
        Checked against {result.basis.entries.toLocaleString('en-US')} deprecation entries and {result.basis.packages.toLocaleString('en-US')} packages
        {result.basis.built_at ? `, index built ${result.basis.built_at.slice(0, 16).replace('T', ' ')} UTC` : ''}.
        {' '}An empty result means none of those match, not that the file is current.
      </p>
      {result.notes.length > 0 && (
        <ul className="ck-notes">
          {result.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </section>
  );
}

export function CheckApp({ exampleCode, exampleFilename, maxChars }: Props) {
  const ids = { code: useId(), file: useId(), lang: useId() };
  const [code, setCode] = useState(exampleCode);
  const [filename, setFilename] = useState(exampleFilename);
  const [language, setLanguage] = useState<'' | Language>('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  const tooLong = code.length > maxChars;
  const canSend = state.kind !== 'busy' && code.trim().length > 0 && !tooLong;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setState({ kind: 'busy' });
    try {
      const result = await runCheck(code, filename.trim(), language);
      setState({ kind: 'done', result, checked: filename.trim() || 'the pasted code' });
    } catch (err) {
      setState({ kind: 'failed', message: err instanceof Error ? err.message : 'The check did not complete.' });
    }
  }

  function loadExample() {
    setCode(exampleCode);
    setFilename(exampleFilename);
    setLanguage('');
    setState({ kind: 'idle' });
  }

  return (
    <div className="ck">
      <form className="ck-form" onSubmit={submit}>
        <div className="ck-head">
          <FileCode2 size={16} aria-hidden="true" />
          <label htmlFor={ids.file} className="pg-sr">File name</label>
          <input id={ids.file} className="ck-file" value={filename} maxLength={200} spellCheck={false}
            onChange={(e) => setFilename(e.target.value)} placeholder="file name, e.g. src/lib.rs" />
          <label htmlFor={ids.lang} className="pg-sr">Language</label>
          <select id={ids.lang} className="ck-lang" value={language} onChange={(e) => setLanguage(e.target.value as '' | Language)}>
            {LANGUAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <label htmlFor={ids.code} className="pg-sr">Code to check</label>
        <textarea id={ids.code} className="ck-code" value={code} spellCheck={false} autoCapitalize="off" autoCorrect="off"
          rows={16} onChange={(e) => setCode(e.target.value)}
          placeholder="Paste one contract, script, package.json or Cargo.toml" />
        <div className="ck-bar">
          <span className={`ck-count${tooLong ? ' ck-count--over' : ''}`}>{code.length.toLocaleString('en-US')} / {maxChars.toLocaleString('en-US')}</span>
          <button type="button" className="pg-btn pg-btn--line" onClick={loadExample} disabled={state.kind === 'busy'}>
            <RotateCcw size={14} aria-hidden="true" />Example
          </button>
          <button type="submit" className="pg-btn" disabled={!canSend}>
            {state.kind === 'busy' ? 'Checking…' : 'Check'}
          </button>
        </div>
        {tooLong && <p className="ck-error" role="alert">One file per check, at most {maxChars.toLocaleString('en-US')} characters.</p>}
      </form>

      {state.kind === 'failed' && <p className="ck-error" role="alert">The check failed: {state.message}</p>}
      {state.kind === 'done' && <Results result={state.result} checked={state.checked} />}
      {state.kind === 'idle' && (
        <p className="ck-basis">The example is a near-sdk-js counter contract with a near-api-js v4 client, the kind of file an agent writes from memory. Press Check to see what is stale in it.</p>
      )}
    </div>
  );
}
