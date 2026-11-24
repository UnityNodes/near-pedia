import { probeRerankerSteady, type RerankProbe } from '../lib/reranker';
import { guardSync, logRun } from '../lib/sync-log';

function describe(p: RerankProbe): string {
  return `${p.ok ? 'ok' : 'FAILED'} in ${p.ms}ms${p.error ? `: ${p.error}` : ''}`;
}

async function main(): Promise<void> {
  const s = await probeRerankerSteady();
  const failed = s.runs.filter(r => !r.ok).length;
  const line = `${s.provider ?? 'none'} ${s.ok ? 'ok' : 'FAILED'}, ${s.runs.length - failed} of ${s.runs.length} probe(s) passed: ${s.runs.map(describe).join('; ')}`;
  (s.ok ? console.log : console.error)(`[check-reranker] ${line}`);
  logRun('check-reranker', s.ok ? { status: 'success', items: 1 } : { status: 'error', items: 0, error: line.slice(0, 1000) });
  if (!s.ok) process.exitCode = 1;
}

guardSync('check-reranker', main).catch((e) => { console.error('[check-reranker] FATAL', e); process.exit(1); });
