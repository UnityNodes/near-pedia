import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { streamWithCascade } from '@/lib/llm-cascade';
import { getIdentifiers } from '@/lib/rate-limit';
import { classifyUserAgent } from '@/lib/user-agent-classify';
import { fenceUntrusted } from '@/lib/untrusted-fence';

const TLDR_MAX_AGE_DAYS = 30;

const TLDR_LIMIT = 5;
const TLDR_WINDOW_MS = 60 * 60 * 1000;

const tldrRateMap = new Map<string, number[]>();

function checkTldrRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const windowStart = now - TLDR_WINDOW_MS;
  const timestamps = (tldrRateMap.get(ip) ?? []).filter(t => t > windowStart);
  if (timestamps.length >= TLDR_LIMIT) {
    const oldest = timestamps[0];
    const retryAfter = Math.ceil((oldest + TLDR_WINDOW_MS - now) / 1000);
    tldrRateMap.set(ip, timestamps);
    return { allowed: false, retryAfter };
  }
  timestamps.push(now);
  tldrRateMap.set(ip, timestamps);
  return { allowed: true };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { ip } = getIdentifiers(_req);
  const rl = checkTldrRateLimit(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many TL;DR requests. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfter ?? 3600) },
      },
    );
  }

  // Block AI crawlers from triggering fresh LLM generation. They can
  // scrape full CIP content from /cips/[id] directly; spending Gemini
  // quota on a TLDR they'd then re-summarize anyway just starves real
  // users. Cached TLDR is still served (it's already paid for).
  const agentClass = classifyUserAgent(_req.headers.get('user-agent'));
  const isCrawler = agentClass === 'ai_bot' || agentClass === 'search_bot';

  const db = getDb();

  const row = db.prepare('SELECT tldr, tldr_generated_at, content_md FROM cips WHERE id = ?').get(id) as
    { tldr: string | null; tldr_generated_at: string | null; content_md: string | null } | undefined;

  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (row.tldr && row.tldr_generated_at) {
    const age = Date.now() - new Date(row.tldr_generated_at).getTime();
    if (age < TLDR_MAX_AGE_DAYS * 86400_000) {
      return NextResponse.json({ tldr: row.tldr, cached: true });
    }
  }

  if (isCrawler) {
    return NextResponse.json(
      { tldr: null, cached: false, reason: 'agent_class_blocked' },
      { status: 403, headers: { 'X-Agent-Class': agentClass } },
    );
  }

  if (!row.content_md || row.content_md.length < 100) {
    return NextResponse.json({ error: 'no content' }, { status: 422 });
  }

  const snippet = row.content_md.slice(0, 3000);

  let tldr = '';
  try {
    for await (const chunk of streamWithCascade({
      messages: [
        {
          role: 'system',
          content: 'You are a technical summarizer for NEAR governance proposals. Write exactly 2-3 sentences summarizing the key purpose, mechanism, and impact of the CIP. Be precise and concise. No bullet points, no headers, no markdown.',
        },
        {
          // Same fence as scripts/backfill-tldrs.ts: content_md merges via a
          // reviewed PR, not an anonymous post, but it's still third-party
          // text reaching the model.
          role: 'user',
          content: `Summarize this Chain Improvement Proposal in 2-3 sentences:\n\n${fenceUntrusted(snippet)}`,
        },
      ],
      maxTokens: 150,
      temperature: 0.3,
    })) {
      tldr += chunk.text;
    }
  } catch (err) {
    console.error('[tldr] generation failed:', err);
    return NextResponse.json({ error: 'generation failed' }, { status: 502 });
  }

  tldr = tldr.trim();
  db.prepare('UPDATE cips SET tldr = ?, tldr_generated_at = ? WHERE id = ?')
    .run(tldr, new Date().toISOString(), id);

  return NextResponse.json({ tldr, cached: false });
}
