import { describe, expect, it } from 'vitest';
import { MCP_ACCEPT, planAccept, setAcceptHeader } from '../../lib/mcp-accept';

describe('planAccept', () => {
  it('leaves a client that accepts both types alone', () => {
    expect(planAccept('POST', 'application/json, text/event-stream')).toEqual({ lenient: false, jsonReply: false });
    expect(planAccept('POST', 'text/event-stream, application/json;q=0.9')).toEqual({ lenient: false, jsonReply: false });
  });

  it('answers a client that cannot take a stream with plain JSON', () => {
    for (const accept of ['*/*', 'application/json', '', undefined, 'text/html']) {
      expect(planAccept('POST', accept), String(accept)).toEqual({ lenient: true, jsonReply: true });
    }
  });

  it('keeps the stream for a client that asks for one', () => {
    expect(planAccept('POST', 'text/event-stream')).toEqual({ lenient: true, jsonReply: false });
  });

  it('does not loosen anything but POST', () => {
    expect(planAccept('GET', '*/*').lenient).toBe(false);
    expect(planAccept('DELETE', undefined).lenient).toBe(false);
  });
});

describe('setAcceptHeader', () => {
  it('rewrites the raw header the transport reads, whatever its case', () => {
    const req = { headers: { accept: '*/*' }, rawHeaders: ['Host', 'x', 'ACCEPT', '*/*', 'User-Agent', 'y'] };
    setAcceptHeader(req, MCP_ACCEPT);
    expect(req.rawHeaders).toEqual(['Host', 'x', 'ACCEPT', MCP_ACCEPT, 'User-Agent', 'y']);
    expect(req.headers.accept).toBe(MCP_ACCEPT);
  });

  it('adds the header when the client sent none', () => {
    const req = { headers: {} as { accept?: string }, rawHeaders: ['Host', 'x'] };
    setAcceptHeader(req, MCP_ACCEPT);
    expect(req.rawHeaders).toEqual(['Host', 'x', 'Accept', MCP_ACCEPT]);
    expect(req.headers.accept).toBe(MCP_ACCEPT);
  });
});
