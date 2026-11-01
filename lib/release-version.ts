export function releaseLine(version: string | null | undefined): string | null {
  const m = /^v?(\d+)\.(\d+)/.exec(version ?? '');
  return m ? `${m[1]}.${m[2]}` : null;
}

export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const t = v.trim().replace(/^v/, '');
    const [core, pre = ''] = t.split('+')[0].split('-', 2) as [string, string?];
    return { core: core.split('.').map(n => Number(n) || 0), pre };
  };
  const pa = split(a), pb = split(b);
  for (let i = 0; i < Math.max(pa.core.length, pb.core.length); i++) {
    const d = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}
