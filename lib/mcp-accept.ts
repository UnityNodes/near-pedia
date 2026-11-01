export const MCP_ACCEPT = 'application/json, text/event-stream';

export interface AcceptPlan { lenient: boolean; jsonReply: boolean }

export function planAccept(method: string, accept: unknown): AcceptPlan {
  const header = String(accept ?? '');
  const acceptsJson = header.includes('application/json');
  const acceptsStream = header.includes('text/event-stream');
  const lenient = method === 'POST' && !(acceptsJson && acceptsStream);
  return { lenient, jsonReply: lenient && !acceptsStream };
}

export interface HeaderCarrier { headers: { accept?: string }; rawHeaders: string[] }

export function setAcceptHeader(req: HeaderCarrier, value: string): void {
  const raw = req.rawHeaders;
  let found = false;
  for (let i = 0; i < raw.length; i += 2) {
    if (raw[i].toLowerCase() === 'accept') {
      raw[i + 1] = value;
      found = true;
    }
  }
  if (!found) raw.push('Accept', value);
  req.headers.accept = value;
}
