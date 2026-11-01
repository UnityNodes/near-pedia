import { probeEmbeddings } from '../lib/embeddings';
import { guardSync, logRun } from '../lib/sync-log';

async function main(): Promise<void> {
  const p = await probeEmbeddings();
  const line = `openai ${p.ok ? 'ok' : 'FAILED'} in ${p.ms}ms${p.error ? `: ${p.error}` : ''}`;
  (p.ok ? console.log : console.error)(`[check-embeddings] ${line}`);
  logRun('check-embeddings', p.ok ? { status: 'success', items: 1 } : { status: 'error', items: 0, error: line.slice(0, 1000) });
  if (!p.ok) process.exitCode = 1;
}

guardSync('check-embeddings', main).catch((e) => { console.error('[check-embeddings] FATAL', e); process.exit(1); });
