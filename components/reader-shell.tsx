import { Fragment } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Tone } from '@/lib/status';
import '@/app/reader.css';

export interface Crumb {
  label: string;
  href?: string;
}

export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="pg-crumbs" aria-label="Breadcrumb">
      <Link href="/">Home</Link>
      {items.map((c, i) => (
        <Fragment key={`${i}-${c.label}`}>
          <span aria-hidden="true">/</span>
          {c.href ? <Link href={c.href}>{c.label}</Link> : <span className="rd-crumb-now" aria-current="page">{c.label}</span>}
        </Fragment>
      ))}
    </nav>
  );
}

export function ReaderPage({
  crumbs, aside, children, wide = false,
}: {
  crumbs: Crumb[];
  aside?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const layout = aside ? 'rd-grid' : wide ? 'rd-grid rd-grid--wide' : 'rd-grid rd-grid--solo';
  return (
    <main className="pg rd">
      <Crumbs items={crumbs} />
      <div className={layout}>
        <article className="rd-main">{children}</article>
        {aside ? <aside className="rd-aside" aria-label="Details">{aside}</aside> : null}
      </div>
    </main>
  );
}

export function LegalPage({ crumb, children }: { crumb: string; children: ReactNode }) {
  return (
    <main className="pg rd">
      <Crumbs items={[{ label: crumb }]} />
      <div className="rd-grid rd-grid--solo">
        <article className="rd-main legal-page rd-prose">{children}</article>
      </div>
    </main>
  );
}

export function MetaLine({ items }: { items: ReactNode[] }) {
  const shown = items.filter((x) => x !== null && x !== undefined && x !== false && x !== '');
  if (shown.length === 0) return null;
  return (
    <p className="rd-meta">
      {shown.map((item, i) => (
        <Fragment key={i}>
          {i > 0 ? <span aria-hidden="true">·</span> : null}
          {item}
        </Fragment>
      ))}
    </p>
  );
}

export function ReaderHead({
  tags, title, meta, lede, actions,
}: {
  tags?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="rd-head">
      {tags ? <div className="rd-tags">{tags}</div> : null}
      <h1 className="rd-h1">{title}</h1>
      {meta}
      {lede ? <p className="rd-lede">{lede}</p> : null}
      {actions ? <div className="rd-actions">{actions}</div> : null}
    </header>
  );
}

export function AsideCard({
  title, count, children, className,
}: {
  title: string;
  count?: number | string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `rd-card ${className}` : 'rd-card'}>
      <h2 className="rd-card-h">
        <span>{title}</span>
        {count !== undefined ? <b>{count}</b> : null}
      </h2>
      {children}
    </section>
  );
}

export function LinkCards({ title, count, children }: { title: string; count?: number | string; children: ReactNode }) {
  return (
    <section className="rd-block">
      <h2 className="rd-card-h">
        <span>{title}</span>
        {count !== undefined ? <b>{count}</b> : null}
      </h2>
      <ul className="rd-stack">{children}</ul>
    </section>
  );
}

export function RelCard({
  href, tag, tone, meta, title, date,
}: {
  href: string;
  tag?: string;
  tone?: Tone;
  meta?: ReactNode;
  title: ReactNode;
  date?: string;
}) {
  return (
    <li>
      <Link href={href} className="pg-card rd-rel">
        {tag || meta ? (
          <span className="rd-rel-top">
            {tag ? <span className="pg-tag" data-tone={tone ?? 'mute'}>{tag}</span> : null}
            {meta ? <span>{meta}</span> : null}
          </span>
        ) : null}
        <span className="rd-rel-t">{title}</span>
        {date ? <span className="rd-rel-d">{date}</span> : null}
      </Link>
    </li>
  );
}

export function KeyValues({ rows }: { rows: Array<{ k: string; v: ReactNode } | null | undefined | false> }) {
  const shown = rows.filter((r): r is { k: string; v: ReactNode } => Boolean(r));
  return (
    <dl className="rd-kv">
      {shown.map((r) => (
        <Fragment key={r.k}>
          <dt>{r.k}</dt>
          <dd>{r.v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <div className="rd-back">
      <Link href={href}>{children}</Link>
    </div>
  );
}
