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
