'use client';

import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';

const MAX_QUESTION = 2000;
const MAX_CODE = 20_000;

interface Source { n: number; kind: string; title: string; url: string | null; as_of: string | null }
interface Receipt { model: string; signature_kind: string; signing_address: string; tcb_status: string; e2ee: boolean; verified_at: string; verify_url: string }
interface Anchor { date: string; hash: string; network: string | null; explorer_url: string | null }
interface Answer { answer: string; truncated: boolean; sources: Source[]; receipt: Receipt; db_anchor: Anchor | null }

const isHttp = (u: string | null): u is string => !!u && /^https?:\/\//.test(u);

const EXAMPLES = [
  'Was Rhea Finance hacked, and what happened?',
  'When does mainnet move to protocol 88?',
  'What does HSP-029 change, and did it pass?',
  'Is near-sdk-js still safe to use?',
];

export function AskForm() {
  const ids = { q: useId(), code: useId(), file: useId() };
  const [question, setQuestion] = useState('');
  const [code, setCode] = useState('');
  const [filename, setFilename] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Answer | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/v1/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, ...(code.trim() ? { code, filename: filename.trim() || undefined } : {}) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(body?.error ?? `Request failed (${res.status})`);
      else setResult(body as Answer);
    } catch {
      setError('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={submit} className="contact-form" noValidate>
        <div className="contact-form-row">
          <label htmlFor={ids.q}>Question</label>
          <textarea id={ids.q} rows={3} maxLength={MAX_QUESTION} value={question} onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about a protocol upgrade, a vote, a project, an incident or your code" required />
          <div className="pg-chips" aria-label="Example questions">
            {EXAMPLES.map((q) => (
              <button key={q} type="button" className="pg-chip" onClick={() => setQuestion(q)}>{q}</button>
            ))}
          </div>
        </div>
        <details className="contact-form-row" open={code.length > 0}>
          <summary>Add code to check (optional, one file)</summary>
          <textarea id={ids.code} aria-label="Code to check" rows={8} maxLength={MAX_CODE} value={code} onChange={(e) => setCode(e.target.value)}
            placeholder="Paste a contract, a script or a package.json / Cargo.toml" spellCheck={false} style={{ fontFamily: 'var(--font-mono, monospace)' }} />
          <div className="contact-form-meta">{code.length.toLocaleString()} / {MAX_CODE.toLocaleString()}</div>
        </details>
        {code.trim() && (
          <div className="contact-form-row">
            <label htmlFor={ids.file}>File name (helps detect the language)</label>
            <input id={ids.file} value={filename} maxLength={200} onChange={(e) => setFilename(e.target.value)} placeholder="src/lib.rs" />
          </div>
        )}
        <button type="submit" className="pg-btn" disabled={busy || !question.trim()}>{busy ? 'Asking NEAR AI…' : 'Ask'}</button>
      </form>

      {error && <section aria-live="polite"><p className="contact-form-error">{error}</p></section>}

      {result && (
        <section aria-live="polite">
          <h2>Answer</h2>
          <ReactMarkdown
            disallowedElements={['img']}
            components={{ a: ({ href, children }) => (isHttp(href ?? null) ? <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a> : <>{children}</>) }}
          >
            {result.answer}
          </ReactMarkdown>
          {result.truncated && <p className="legal-meta">The answer reached its length limit and stops short.</p>}

          {result.sources.length > 0 && (
            <>
              <h3>Sources</h3>
              <ol>
                {result.sources.map((s) => (
                  <li key={s.n} value={s.n}>
                    {isHttp(s.url) ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title}
                    {s.as_of && <> · read {s.as_of.slice(0, 10)}</>}
                  </li>
                ))}
              </ol>
            </>
          )}

          <h3>Receipt</h3>
          <ul>
            <li>Model: <code>{result.receipt.model}</code>, {result.receipt.e2ee ? 'end-to-end encrypted' : 'not encrypted'}</li>
            <li>
              Signed by {result.receipt.signature_kind === 'provider_tee' ? 'the model’s TEE' : 'the NEAR AI gateway'}{' '}
              <code>{result.receipt.signing_address}</code>, hardware TCB {result.receipt.tcb_status}, verified {result.receipt.verified_at.slice(0, 19).replace('T', ' ')} UTC
            </li>
            <li><a href={result.receipt.verify_url} target="_blank" rel="noopener noreferrer">Verify this reply on NEAR AI</a></li>
            {result.db_anchor && (
              <li>
                Latest daily database hash, {result.db_anchor.date}: <code>{result.db_anchor.hash.slice(0, 16)}…</code>
                {isHttp(result.db_anchor.explorer_url) && <> (<a href={result.db_anchor.explorer_url} target="_blank" rel="noopener noreferrer">recorded on NEAR {result.db_anchor.network}</a>)</>}
              </li>
            )}
          </ul>
        </section>
      )}
    </>
  );
}
