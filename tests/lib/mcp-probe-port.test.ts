import { describe, expect, it } from 'vitest';
import net from 'node:net';
import { freePort } from '@/lib/mcp-probe';

function listen(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

describe('freePort', () => {
  it('returns a port that can be bound right away', async () => {
    const port = await freePort();
    expect(port).toBeGreaterThan(0);
    const srv = await listen(port);
    await new Promise((r) => srv.close(r));
  });

  it('does not hand out a port that is already taken', async () => {
    const held = await listen(0);
    const taken = (held.address() as net.AddressInfo).port;
    const ports = await Promise.all(Array.from({ length: 20 }, () => freePort()));
    expect(ports).not.toContain(taken);
    await new Promise((r) => held.close(r));
  });
});
