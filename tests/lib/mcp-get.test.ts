import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { MCP_ALLOWED_METHODS, refuseMcpGet } from '@/lib/mcp-get';

function capture() {
  const out: { status?: number; headers: Record<string, string>; body?: unknown; ended: boolean } = { headers: {}, ended: false };
  const res = {
    status(code: number) { out.status = code; return res; },
    set(name: string, value: string) { out.headers[name.toLowerCase()] = value; return res; },
    json(body: unknown) { out.body = body; out.ended = true; return res; },
  };
  return { out, res: res as unknown as Response };
}

describe('GET /mcp', () => {
  it('answers 405 with a JSON-RPC error and ends the response instead of opening an SSE stream', () => {
    const { out, res } = capture();
    refuseMcpGet({ method: 'GET', headers: { accept: 'text/event-stream' } } as unknown as Request, res);
    expect(out.status).toBe(405);
    expect(out.headers.allow).toBe(MCP_ALLOWED_METHODS);
    expect(out.ended).toBe(true);
    const body = out.body as { jsonrpc: string; id: null; error: { code: number; message: string } };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBeNull();
    expect(body.error.code).toBe(-32000);
    expect(body.error.message).toMatch(/POST/);
  });

  it('allows the methods the server still serves', () => {
    expect(MCP_ALLOWED_METHODS.split(', ')).toEqual(['POST', 'DELETE']);
  });
});
