import { describe, expect, it } from 'vitest';
import { notifier } from '@/lib/sd-notify';
import { heartbeat } from '@/lib/agent-heartbeat';

function recorder(status = 0) {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const run = (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return { status, error: undefined };
  };
  return { calls, run };
}

const SYSTEMD = { NOTIFY_SOCKET: '/run/systemd/notify', WATCHDOG_USEC: '180000000' };

describe('sd_notify outside systemd', () => {
  it('does nothing and never spawns when NOTIFY_SOCKET is absent', () => {
    const r = recorder();
    const n = notifier({}, 42, r.run);
    expect(n.enabled).toBe(false);
    expect([n.ready(), n.alive(), n.stretch(600_000), n.restore()]).toEqual([false, false, false, false]);
    expect(r.calls).toHaveLength(0);
  });
});

describe('sd_notify under systemd', () => {
  it('sends READY and WATCHDOG through systemd-notify as the main pid', () => {
    const r = recorder();
    const n = notifier(SYSTEMD, 42, r.run);
    expect(n.ready()).toBe(true);
    expect(n.alive()).toBe(true);
    expect(r.calls).toEqual([
      { cmd: 'systemd-notify', args: ['--pid=42', 'READY=1'] },
      { cmd: 'systemd-notify', args: ['--pid=42', 'WATCHDOG=1'] },
    ]);
  });

  it('stretches the watchdog for a long job and puts the unit value back after', () => {
    const r = recorder();
    const n = notifier(SYSTEMD, 7, r.run);
    n.stretch(610_000);
    n.restore();
    expect(r.calls.map((c) => c.args)).toEqual([
      ['--pid=7', 'WATCHDOG_USEC=610000000', 'WATCHDOG=1'],
      ['--pid=7', 'WATCHDOG_USEC=180000000', 'WATCHDOG=1'],
    ]);
  });

  it('never shrinks the watchdog below the unit value', () => {
    const r = recorder();
    notifier(SYSTEMD, 7, r.run).stretch(1_000);
    expect(r.calls[0].args[1]).toBe('WATCHDOG_USEC=180000000');
  });

  it('leaves the timeout alone when the unit has no WatchdogSec', () => {
    const r = recorder();
    const n = notifier({ NOTIFY_SOCKET: '/run/systemd/notify' }, 7, r.run);
    expect(n.stretch(610_000)).toBe(false);
    expect(n.alive()).toBe(true);
    expect(r.calls).toHaveLength(1);
  });

  it('reports a failed notify instead of throwing', () => {
    const r = recorder(1);
    expect(notifier(SYSTEMD, 7, r.run).alive()).toBe(false);
  });
});

describe('agent heartbeat', () => {
  it('beats after every poll and logs only every Nth empty one in a row', () => {
    const r = recorder();
    const pulse = heartbeat(notifier(SYSTEMD, 1, r.run), 3);
    const notes = [0, 0, 0, 0, 1, 0, 0, 0].map((w) => pulse.afterPoll(w));
    expect(r.calls).toHaveLength(8);
    expect(notes).toEqual([null, null, '[agent] 3 polls in a row with nothing to do, still polling', null, null, null, null, '[agent] 3 polls in a row with nothing to do, still polling']);
  });

  it('beats after a failed poll without counting it as empty', () => {
    const r = recorder();
    const pulse = heartbeat(notifier(SYSTEMD, 1, r.run), 2);
    expect([pulse.afterPoll(0), pulse.afterPoll(null), pulse.afterPoll(0)]).toEqual([null, null, '[agent] 2 polls in a row with nothing to do, still polling']);
    expect(r.calls).toHaveLength(3);
  });

  it('restores the watchdog even when the job throws, and beats on progress', async () => {
    const r = recorder();
    const pulse = heartbeat(notifier(SYSTEMD, 1, r.run));
    await expect(pulse.job(610_000, async (beat) => { beat(); throw new Error('clone failed'); })).rejects.toThrow('clone failed');
    expect(r.calls.map((c) => c.args.slice(1))).toEqual([
      ['WATCHDOG_USEC=610000000', 'WATCHDOG=1'],
      ['WATCHDOG=1'],
      ['WATCHDOG_USEC=180000000', 'WATCHDOG=1'],
    ]);
  });
});

describe('agent worker network calls', () => {
  it('puts a timeout on every fetch it makes', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(`${__dirname}/../../scripts/agent-market-worker.ts`, 'utf8');
    const fetches = src.match(/\bfetch\(/g) ?? [];
    const bounded = src.match(/signal: AbortSignal\.timeout\(FETCH_TIMEOUT_MS\)/g) ?? [];
    expect(fetches.length).toBeGreaterThan(0);
    expect(bounded.length).toBe(fetches.length);
  });

  it('runs as a notify unit with a watchdog, and as the main process so the notify pid matches', async () => {
    const fs = await import('fs');
    const unit = fs.readFileSync(`${__dirname}/../../deploy/nearpedia-agent.service`, 'utf8');
    expect(unit).toMatch(/^Type=notify$/m);
    expect(unit).toMatch(/^WatchdogSec=180$/m);
    expect(unit).toMatch(/^ExecStart=\S+\/node --import tsx scripts\/agent-market-worker\.ts$/m);
  });
});
