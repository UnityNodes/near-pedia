'use client';

import { useSyncExternalStore } from 'react';
import { agoLabel } from './freshness';

const TICK_MS = 30_000;

function subscribe(onTick: () => void): () => void {
  const id = setInterval(onTick, TICK_MS);
  return () => clearInterval(id);
}

function clientNow(): number {
  return Math.floor(Date.now() / TICK_MS) * TICK_MS;
}

export function SyncAge({ iso, serverNow }: { iso: string; serverNow: number }) {
  const now = useSyncExternalStore(subscribe, clientNow, () => serverNow);
  return <time dateTime={iso} title={iso}>{agoLabel(iso, now)}</time>;
}
