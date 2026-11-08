import type { Request, Response } from 'express';

export const MCP_ALLOWED_METHODS = 'POST, DELETE';

export const MCP_GET_REFUSAL = {
  jsonrpc: '2.0',
  error: { code: -32000, message: 'Method not allowed: this server has no SSE stream. Send JSON-RPC requests with POST /mcp.' },
  id: null,
} as const;

export function refuseMcpGet(_req: Request, res: Response): void {
  res.status(405).set('Allow', MCP_ALLOWED_METHODS).json(MCP_GET_REFUSAL);
}
