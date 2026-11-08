export const DAY_MS = 86_400_000;

export interface SyncStamp {
  last_synced: string | null;
}

export function countSyncedWithin(sources: readonly SyncStamp[], windowMs: number, now: number): number {
  return sources.filter((s) => {
    if (!s.last_synced) return false;
    const at = Date.parse(s.last_synced);
    return Number.isFinite(at) && now - at < windowMs;
  }).length;
}

export function countSyncedToday(sources: readonly SyncStamp[]): number {
  return countSyncedWithin(sources, DAY_MS, Date.now());
}
