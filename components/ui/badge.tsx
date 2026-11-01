import type { CSSProperties, ReactNode } from 'react';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'note' | 'live' | 'accent' | 'neutral';

const TONE_VAR: Record<Tone, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
  info: 'var(--info)',
  note: 'var(--note)',
  live: 'var(--live)',
  accent: 'var(--accent-text)',
  neutral: 'var(--fg-mute-text)',
};

interface Props {
  children: ReactNode;
  tone?: Tone | (string & {});
  variant?: 'tint' | 'solid' | 'plain';
  size?: 'xs' | 'sm' | 'md';
  title?: string;
  style?: CSSProperties;
}

export function Badge({ children, tone = 'neutral', variant = 'tint', size = 'md', title, style }: Props) {
  const cls = ['ui-badge'];
  if (variant !== 'tint') cls.push(`ui-badge--${variant}`);
  if (size !== 'md') cls.push(`ui-badge--${size}`);

  const resolved = TONE_VAR[tone as Tone] ?? tone;

  return (
    <span
      className={cls.join(' ')}
      title={title}
      style={{ ['--tone' as string]: resolved, ...style }}
    >
      {children}
    </span>
  );
}
