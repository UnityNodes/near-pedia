export type FirstValues<T> = { [K in keyof T]?: string };

export function firstValues<T extends object>(raw: T | null | undefined): FirstValues<T> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    const first: unknown = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string') out[key] = first;
  }
  return out as FirstValues<T>;
}
