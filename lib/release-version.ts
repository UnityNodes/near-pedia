export function releaseLine(version: string | null | undefined): string | null {
  const m = /^v?(\d+)\.(\d+)/.exec(version ?? '');
  return m ? `${m[1]}.${m[2]}` : null;
}

/**
 * Semver order. Prerelease identifiers compare one by one, numbers as
 * numbers: as strings, rc.10 sorted below rc.2, and splitting on the first
 * two '-' only made rc.1-x and rc.1-y equal.
 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const t = v.trim().replace(/^v/, '').split('+')[0];
    const dash = t.indexOf('-');
    const core = dash < 0 ? t : t.slice(0, dash);
    const pre = dash < 0 ? '' : t.slice(dash + 1);
    return { core: core.split('.').map(n => Number(n) || 0), pre: pre ? pre.split('.') : [] };
  };
  const pa = split(a), pb = split(b);
  for (let i = 0; i < Math.max(pa.core.length, pb.core.length); i++) {
    const d = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (!pa.pre.length || !pb.pre.length) return pa.pre.length === pb.pre.length ? 0 : pa.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i], y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) < Number(y) ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
