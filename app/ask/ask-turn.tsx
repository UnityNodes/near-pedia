'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import { Check, Copy, FileCode2, RotateCcw, ShieldCheck } from 'lucide-react';
import { SITE } from '@/lib/site.config';
import { isHttp, type Answer, type Source, type Turn } from './types';
import { citeId, citedNumbers, linkCitations } from './citations';

const COPIED_MS = 1600;

function AnswerText({ turnId, answer }: { turnId: string; answer: Answer }) {
  return (
    <div className="ak-md">
      <ReactMarkdown
        disallowedElements={['img']}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('#ak-src-')) return <a className="ak-cite" href={href}>{children}</a>;
            return isHttp(href) ? <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a> : <>{children}</>;
          },
        }}
      >
        {linkCitations(answer.answer, turnId, answer.sources.length)}
      </ReactMarkdown>
      {answer.truncated && <p className="ak-note">The answer reached its length limit and stops short.</p>}
    </div>
  );
}

function host(url: string | null): string | null {
  if (!isHttp(url)) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function SourceCard({ turnId, source }: { turnId: string; source: Source }) {
  const where = host(source.url) ?? 'this index';
  const body = (
    <>
      <span className="ak-card-top"><span className="ak-card-n">{source.n}</span><span className="ak-card-host">{where}</span></span>
      <span className="ak-card-title">{source.title}</span>
      <span className="ak-card-meta">{source.kind.replace('_', ' ')}{source.as_of && ` · read ${source.as_of.slice(0, 10)}`}</span>
    </>
  );
  return isHttp(source.url)
    ? <a id={citeId(turnId, source.n)} className="ak-card" href={source.url} target="_blank" rel="noopener noreferrer">{body}</a>
    : <div id={citeId(turnId, source.n)} className="ak-card">{body}</div>;
}

function Sources({ turnId, answer }: { turnId: string; answer: Answer }) {
  if (answer.sources.length === 0) return null;
  const cited = citedNumbers(answer.answer);
  const used = answer.sources.filter((s) => cited.has(s.n));
  const rest = answer.sources.filter((s) => !cited.has(s.n));
  return (
    <div className="ak-sourcebox">
      {used.length > 0 && <div className="ak-cards" aria-label="Sources cited">{used.map((s) => <SourceCard key={s.n} turnId={turnId} source={s} />)}</div>}
      {rest.length > 0 && (
        <details className="ak-more">
          <summary>{used.length > 0 ? `${rest.length} more searched, not cited` : `${rest.length} sources searched`}</summary>
          <div className="ak-cards">{rest.map((s) => <SourceCard key={s.n} turnId={turnId} source={s} />)}</div>
        </details>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(id);
  }, [copied]);
  const copy = () => navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
  return (
    <button type="button" className="ak-act" onClick={copy} aria-label="Copy the answer">
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

function Receipt({ answer }: { answer: Answer }) {
  const r = answer.receipt;
  const signer = r.signature_kind === 'provider_tee' ? 'the model’s TEE' : 'the NEAR AI gateway';
  return (
    <details className="ak-receipt">
      <summary className="ak-act ak-act--ok"><ShieldCheck size={14} aria-hidden="true" /><span>Verified · {r.model.split('/').pop()}</span></summary>
      <div className="ak-receipt-pop">
        <p>Model <code>{r.model}</code>, {r.e2ee ? 'end-to-end encrypted' : 'not encrypted'}.</p>
        <p>Signed by {signer} <code>{r.signing_address}</code>, hardware TCB {r.tcb_status}, verified {r.verified_at.slice(0, 19).replace('T', ' ')} UTC.</p>
        {answer.db_anchor && (
          <p>
            Database hash of {answer.db_anchor.date}: <code>{answer.db_anchor.hash.slice(0, 16)}…</code>
            {isHttp(answer.db_anchor.explorer_url) && <> · <a href={answer.db_anchor.explorer_url} target="_blank" rel="noopener noreferrer">on NEAR {answer.db_anchor.network}</a></>}
          </p>
        )}
        <a href={r.verify_url} target="_blank" rel="noopener noreferrer">Verify this reply on NEAR AI</a>
      </div>
    </details>
  );
}

function Pending({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.round((now - Date.parse(since)) / 1000));
  return (
    <div className="ak-pending" role="status">
      <span className="ak-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>Searching the index, asking NEAR AI in a TEE, checking the signature</span>
      <span className="ak-elapsed" aria-hidden="true">{seconds}s</span>
    </div>
  );
}

export function BotAvatar() {
  return <Image src={SITE.logo.mark} alt="" width={30} height={30} className="ak-avatar" unoptimized />;
}

export function AskTurn({ turn, onRetry }: { turn: Turn; onRetry: (turn: Turn) => void }) {
  return (
    <article className="ak-turn">
      <div className="ak-me">
        <div className="ak-me-bubble">
          <p>{turn.question}</p>
          {turn.code && <span className="ak-attach"><FileCode2 size={13} aria-hidden="true" />{turn.code.filename || 'pasted file'}</span>}
        </div>
      </div>
      <div className="ak-bot">
        <BotAvatar />
        <div className="ak-bot-body">
          {turn.status === 'pending' && <Pending since={turn.askedAt} />}
          {turn.status === 'error' && (
            <div className="ak-error">
              <p>{turn.error}</p>
              <button type="button" className="ak-act" onClick={() => onRetry(turn)}><RotateCcw size={14} aria-hidden="true" /><span>Try again</span></button>
            </div>
          )}
          {turn.status === 'done' && turn.result && (
            <>
              <AnswerText turnId={turn.id} answer={turn.result} />
              <Sources turnId={turn.id} answer={turn.result} />
              <div className="ak-actions">
                <CopyButton text={turn.result.answer} />
                <Receipt answer={turn.result} />
              </div>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
