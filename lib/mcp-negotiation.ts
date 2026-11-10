export const UNSUPPORTED_PROTOCOL_VERSION = -32022;

export function isVersionNegotiation(status: number, messages: readonly unknown[]): boolean {
  if (status !== 400) return false;
  return messages.some(m => {
    const error = (m as { error?: { code?: unknown } } | null)?.error;
    return error?.code === UNSUPPORTED_PROTOCOL_VERSION;
  });
}

export function isTransportProbe(method: string, status: number): boolean {
  if (method === 'HEAD') return true;
  return method === 'GET' && (status === 405 || status === 406);
}

const REFUSAL_TEXT_MAX = 160;

export function refusalDetail(status: number, method: string, protocol: string | undefined, messages: readonly unknown[]): string {
  const head = `HTTP ${status} on ${method} /mcp (protocol ${protocol ?? 'none'})`;
  for (const m of messages) {
    const error = (m as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    if (!error || typeof error.message !== 'string' || !error.message.trim()) continue;
    const text = error.message.replace(/\s+/g, ' ').trim().slice(0, REFUSAL_TEXT_MAX);
    const code = typeof error.code === 'number' ? ` ${error.code}` : '';
    return `${head}:${code} ${text}`;
  }
  return head;
}
