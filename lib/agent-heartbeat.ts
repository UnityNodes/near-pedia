import type { Notifier } from './sd-notify';

export const EMPTY_POLL_LOG_EVERY = 20;

export interface Heartbeat {
  afterPoll(worked: number | null): string | null;
  job<T>(quietMs: number, run: (beat: () => void) => Promise<T>): Promise<T>;
}

export function heartbeat(notify: Notifier, every = EMPTY_POLL_LOG_EVERY): Heartbeat {
  let empty = 0;
  return {
    afterPoll(worked) {
      notify.alive();
      if (worked === null) return null;
      if (worked > 0) {
        empty = 0;
        return null;
      }
      empty += 1;
      return empty % every === 0 ? `[agent] ${empty} polls in a row with nothing to do, still polling` : null;
    },
    async job(quietMs, run) {
      notify.stretch(quietMs);
      try {
        return await run(() => notify.alive());
      } finally {
        notify.restore();
      }
    },
  };
}
