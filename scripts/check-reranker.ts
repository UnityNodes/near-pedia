import { probeReranker } from '../lib/reranker';
import { guardSync, logRun } from '../lib/sync-log';

async function main(): Promise<void> {
  const p = await probeReranker();
  const line = `${p.provider ?? 'none'} ${p.ok ? 'ok' : 'FAILED'} in ${p.ms}ms${p.error ? `: ${p.error}` : ''}`;
  (p.ok ? console.log : console.error)(`[check-reranker] ${line}`);
  logRun('check-reranker', p.ok ? { status: 'success', items: 1 } : { status: 'error', items: 0, error: line.slice(0, 1000) });
  if (!p.ok) process.exitCode = 1;
}

guardSync('check-reranker', main).catch((e) => { console.error('[check-reranker] FATAL', e); process.exit(1); });
