import { getDb } from '../lib/db';
import { guardSync } from '../lib/sync-log';
import { streamWithCascade } from '../lib/llm-cascade';
import { fenceUntrusted } from '../lib/untrusted-fence';

async function main() {
  const db = getDb();

  const cips = db.prepare(`
    SELECT id, content_md FROM cips
    WHERE (tldr IS NULL OR tldr_generated_at < datetime('now', '-30 days'))
      AND content_md IS NOT NULL
      AND length(content_md) > 100
    ORDER BY cip_number ASC
  `).all() as { id: string; content_md: string }[];

  console.log(`[backfill-tldrs] ${cips.length} CIPs to process`);
  let done = 0;

  for (const cip of cips) {
    const snippet = cip.content_md.slice(0, 3000);
    let tldr = '';
    try {
      for await (const chunk of streamWithCascade({
        messages: [
          {
            role: 'system',
            content: 'You are a technical summarizer for Chain Improvement Proposals (CIPs). YourChain is a blockchain network; CIPs govern its protocol. Write exactly 2-3 sentences summarizing the key purpose, mechanism, and impact of the CIP. Be precise and concise. Never call it a YourChain proposal. No bullet points, no headers, no markdown.',
          },
          {
            // content_md merges to main via a reviewed GitHub PR, a much
            // higher bar than an anonymous forum post - but it's still text
            // written by someone outside yourpedia, so it gets the same
            // fence as any other retrieved text before it reaches the model.
            role: 'user',
            content: `Summarize this Chain Improvement Proposal in 2-3 sentences:\n\n${fenceUntrusted(snippet)}`,
          },
        ],
        maxTokens: 150,
        temperature: 0.3,
      })) {
        tldr += chunk.text;
      }
      tldr = tldr.trim();
      db.prepare('UPDATE cips SET tldr = ?, tldr_generated_at = ? WHERE id = ?')
        .run(tldr, new Date().toISOString(), cip.id);
      done++;
      console.log(`[backfill-tldrs] CIP-${cip.id} ok`);
    } catch (err) {
      console.warn(`[backfill-tldrs] CIP-${cip.id} failed:`, err);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[backfill-tldrs] done: ${done}/${cips.length} summarised`);
  return done;
}

guardSync('tldrs', main).catch(e => { console.error(e); process.exit(1); });
