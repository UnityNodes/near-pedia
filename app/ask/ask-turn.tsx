'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import { FileCode2, RotateCcw, ShieldCheck } from 'lucide-react';
import { SITE } from '@/lib/site.config';
import { isHttp, type Answer, type Source, type Turn } from './types';
import { citeId, citedNumbers, linkCitations } from './citations';

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

function SourceItem({ turnId, source }: { turnId: string; source: Source }) {
  return (
    <li id={citeId(turnId, source.n)}>
      <span className="ak-src-n">{source.n}</span>
      <span className="ak-src-body">
        {isHttp(source.url) ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a> : <span>{source.title}</span>}
        <span className="ak-src-meta">{source.kind.replace('_', ' ')}{source.as_of && ` · read ${source.as_of.slice(0, 10)}`}</span>
      </span>
    </li>
  );
}

function SourceList({ turnId, answer }: { turnId: string; answer: Answer }) {
  if (answer.sources.length === 0) return null;
  const cited = citedNumbers(answer.answer);
  const used = answer.sources.filter((s) => cited.has(s.n));
  const rest = answer.sources.filter((s) => !cited.has(s.n));
  return (
    <div className="ak-sourcebox">
      {used.length > 0 && (
        <ol className="ak-sources" aria-label="Sources cited">
          {used.map((s) => <SourceItem key={s.n} turnId={turnId} source={s} />)}
        </ol>
      )}
      {rest.length > 0 && (
        <details className="ak-more">
          <summary>{used.length > 0 ? `Also searched, not cited (${rest.length})` : `Sources searched (${rest.length})`}</summary>
          <ol className="ak-sources">
            {rest.map((s) => <SourceItem key={s.n} turnId={turnId} source={s} />)}
          </ol>
        </details>
      )}
    </div>
  );
}

function ReceiptLine({ answer }: { answer: Answer }) {
  const r = answer.receipt;
  const signer = r.signature_kind === 'provider_tee' ? 'the model’s TEE' : 'the NEAR AI gateway';
  return (
    <details className="ak-receipt">
      <summary>
        <ShieldCheck size={14} aria-hidden="true" />
        <span>Signature verified · {r.model.split('/').pop()}</span>
        <a href={r.verify_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Verify on NEAR AI</a>
      </summary>
      <ul>
        <li>Model <code>{r.model}</code>, {r.e2ee ? 'end-to-end encrypted' : 'not encrypted'}</li>
        <li>Signed by {signer} <code>{r.signing_address}</code>, hardware TCB {r.tcb_status}</li>
        <li>Verified {r.verified_at.slice(0, 19).replace('T', ' ')} UTC</li>
        {answer.db_anchor && (
          <li>
            Database hash of {answer.db_anchor.date}: <code>{answer.db_anchor.hash.slice(0, 16)}…</code>
            {isHttp(answer.db_anchor.explorer_url) && <> · <a href={answer.db_anchor.explorer_url} target="_blank" rel="noopener noreferrer">on NEAR {answer.db_anchor.network}</a></>}
          </li>
        )}
      </ul>
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

function Avatar() {
  return <Image src={SITE.logo.mark} alt="" width={32} height={32} className="ak-avatar" unoptimized />;
}

export function AskTurn({ turn, onRetry }: { turn: Turn; onRetry: (turn: Turn) => void }) {
  return (
    <div className="ak-turn">
      <div className="ak-msg ak-msg--me">
        <div className="ak-bubble ak-bubble--me">
          <p>{turn.question}</p>
          {turn.code && <span className="ak-attach"><FileCode2 size={13} aria-hidden="true" />{turn.code.filename || 'pasted file'}</span>}
        </div>
      </div>
      <div className="ak-msg">
        <Avatar />
        <div className="ak-bubble ak-bubble--bot">
          {turn.status === 'pending' && <Pending since={turn.askedAt} />}
          {turn.status === 'error' && (
            <div className="ak-error">
              <p>{turn.error}</p>
              <button type="button" className="ak-ghost" onClick={() => onRetry(turn)}><RotateCcw size={13} aria-hidden="true" />Try again</button>
            </div>
          )}
          {turn.status === 'done' && turn.result && (
            <>
              <AnswerText turnId={turn.id} answer={turn.result} />
              <SourceList turnId={turn.id} answer={turn.result} />
              <ReceiptLine answer={turn.result} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
