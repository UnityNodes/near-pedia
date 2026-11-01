import Link from 'next/link';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  active?: boolean;
  href?: string;
  title?: string;
  type?: 'button' | 'submit';
  name?: string;
  value?: string;
  /** Keep the label's own casing. For names, tags, versions. */
  asIs?: boolean;
}

export function FilterPill({ children, active = false, href, title, type, name, value, asIs }: Props) {
  const cls = [
    'ui-filter',
    active ? 'ui-filter--active' : '',
    asIs ? 'ui-filter--asis' : '',
  ].filter(Boolean).join(' ');

  if (href) {
    return (
      <Link href={href} className={cls} title={title} aria-current={active ? 'page' : undefined}>
        {children}
      </Link>
    );
  }

  return (
    <button className={cls} title={title} type={type ?? 'button'} name={name} value={value} aria-pressed={active}>
      {children}
    </button>
  );
}

export function FilterRow({ children }: { children: ReactNode }) {
  return <div className="ui-filter-row">{children}</div>;
}
