/**
 * Dated ecosystem events no sync reads: each one written here with its
 * source, and dropped from the radar at its own date.
 *
 * Potlock rounds were asked for and are not here: on 2026-11-01
 * api.potlock.io answered 522, dev.potlock.io serves the staging factory,
 * and potfactory.potlock.near has no contract code on mainnet.
 */

import type { RadarLevel } from './near-radar';

export interface RadarEvent {
  id: string;
  level: RadarLevel;
  title: string;
  body: string;
  url: string;
  /** When it was announced. */
  announced_at: string;
  /** The deadline or the start; the item expires here. */
  at: string;
  affects: string[];
}

export const RADAR_EVENTS: readonly RadarEvent[] = [
  {
    id: 'near-hackathon-2026-submissions',
    level: 'ecosystem',
    title: 'NEAR Hackathon: submissions close 14 November 23:59 UTC',
    body: 'The NEAR Hackathon (1–14 November 2026) takes one submission per project: a public repository, a post on X with a video, and the form. The submission API answers 403 after the deadline.',
    url: 'https://nearhackathon.com/HACKATHON.md',
    announced_at: '2026-10-19T00:00:00.000Z',
    at: '2026-11-14T23:59:00.000Z',
    affects: ['developer'],
  },
];
