import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

type Runner = (cmd: string, args: string[], opts: { timeout: number; stdio: 'ignore' }) => Pick<SpawnSyncReturns<Buffer>, 'status' | 'error'>;

const NOTIFY_TIMEOUT_MS = 5_000;

export interface Notifier {
  enabled: boolean;
  send(state: Record<string, string | number>): boolean;
  ready(): boolean;
  alive(): boolean;
  stretch(ms: number): boolean;
  restore(): boolean;
}

export function notifier(env: Record<string, string | undefined> = process.env, pid = process.pid, run: Runner = spawnSync): Notifier {
  const enabled = Boolean(env.NOTIFY_SOCKET);
  const watchdogUsec = Number(env.WATCHDOG_USEC) || 0;
  const send = (state: Record<string, string | number>): boolean => {
    if (!enabled) return false;
    const args = [`--pid=${pid}`, ...Object.entries(state).map(([k, v]) => `${k}=${v}`)];
    const r = run('systemd-notify', args, { timeout: NOTIFY_TIMEOUT_MS, stdio: 'ignore' });
    return !r.error && r.status === 0;
  };
  return {
    enabled,
    send,
    ready: () => send({ READY: 1 }),
    alive: () => send({ WATCHDOG: 1 }),
    stretch: (ms) => (watchdogUsec ? send({ WATCHDOG_USEC: Math.max(watchdogUsec, ms * 1000), WATCHDOG: 1 }) : false),
    restore: () => (watchdogUsec ? send({ WATCHDOG_USEC: watchdogUsec, WATCHDOG: 1 }) : false),
  };
}
