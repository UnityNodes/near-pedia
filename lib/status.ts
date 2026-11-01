export type Tone = 'lime' | 'ok' | 'info' | 'mute' | 'bad';

const TONE_BY_STATUS: Record<string, Tone> = {
  Draft: 'lime',
  'Early Draft': 'lime',
  'Proposed Amendment': 'lime',
  Proposed: 'lime',
  'Last Call': 'lime',
  Open: 'lime',
  Approved: 'ok',
  Active: 'ok',
  Living: 'ok',
  Implemented: 'ok',
  Review: 'info',
  'In Review': 'info',
  Merged: 'info',
  Final: 'mute',
  Stagnant: 'mute',
  Withdrawn: 'mute',
  Rejected: 'mute',
  Replaced: 'mute',
  Obsolete: 'mute',
  Superseded: 'mute',
  Closed: 'mute',
};

export function statusTone(status: string | null | undefined): Tone {
  return (status && TONE_BY_STATUS[status]) || 'mute';
}

const LITERAL_BY_TONE: Record<Tone, string> = {
  lime: '#D4FF00',
  ok: '#00C853',
  info: '#5B8DEF',
  mute: '#8B93A7',
  bad: '#EC6569',
};

const TOKEN_BY_TONE: Record<Tone, string> = {
  lime: 'var(--accent-text)',
  ok: 'var(--ok)',
  info: 'var(--cy)',
  mute: 'var(--fg-mute-text)',
  bad: 'var(--bad)',
};

export const STATUS_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(TONE_BY_STATUS).map(([status, tone]) => [status, LITERAL_BY_TONE[tone]]),
);

export const STATUS_TOKENS: Record<string, string> = Object.fromEntries(
  Object.entries(TONE_BY_STATUS).map(([status, tone]) => [status, TOKEN_BY_TONE[tone]]),
);

