import { getDb } from '../lib/db';

// Advisory spam scanner. Doesn't delete anything - prints candidates for an
// operator to review by eye, on top of the HARD, enforced signal
// (lib/refusals.ts's SPAM_TOPIC_IDS/SPAM_TITLE_PATTERNS, applied at the door
// by sync-forum.ts and swept retroactively by its cleanupExistingSpam()). A
// topic already on that list is refused before it ever reaches forum_topics,
// so it will never show up here - this script only ever sees what the hard
// rule let through.
//
// WHY THE SIGNALS BELOW ARE STRUCTURAL, NOT KEYWORD-BASED. forum.yourchain.example
// has no low-moderation category that spam tends to land in (the same absence
// scripts/refresh-radar.ts already documents), and a full scan of every quiet,
// one-shot topic in this corpus (255 topics, 2026-09) found nothing that
// looked like spam: validator announcements, CIP drafts, category-intro
// posts, no promotional content anywhere in the sample. A keyword list
// applied to a community it was never tuned against risks exactly what
// already happened once with a boilerplate-opener guess (documented
// in lib/refusals.ts: a "License. Larifi..." pattern that flagged a real
// user's legitimate licensing question, not spam). So this scores only on
// engagement shape - a signal that means the same thing regardless of
// community - and leaves keyword judgement to the narrow, evidence-based
// list in lib/refusals.ts.
//
// Run: `npx tsx scripts/audit-forum-spam.ts`

interface Candidate {
  id: number;
  title: string;
  category_id: number;
  posts_count: number;
  reply_count: number;
  views: number;
  like_count: number;
  created_at: string;
  last_poster_username: string | null;
  score: number;
  reasons: string[];
}

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

function scoreTopic(t: {
  id: number; title: string; category_id: number;
  posts_count: number; reply_count: number;
  views: number; like_count: number; created_at: string;
}): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const ageMs = Date.now() - new Date(t.created_at).getTime();
  const oldEnoughForEngagement = ageMs > SEVEN_DAYS_MS;

  if (t.posts_count <= 1 && (t.reply_count ?? 0) === 0) {
    score += 2;
    reasons.push('one-shot(+2)');
  }
  if (oldEnoughForEngagement) {
    if ((t.like_count ?? 0) === 0) {
      score += 1;
      reasons.push('0_likes(+1)');
    }
    if ((t.views ?? 0) < 50) {
      score += 2;
      reasons.push('views<50(+2)');
    }
  }
  // Repetition: same phrase repeated in title - a structural tell (spam
  // templates stuff a keyword twice for search reach), not a word list.
  const m = t.title.toLowerCase().match(/(.{8,}?)\s+\1/);
  if (m) {
    score += 3;
    reasons.push('title_repetition(+3)');
  }

  return { score, reasons };
}

function main() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, title, category_id, posts_count, reply_count, views, like_count,
           created_at, last_poster_username
    FROM forum_topics
  `).all() as Candidate[];

  const candidates: Candidate[] = [];
  for (const t of rows) {
    const { score, reasons } = scoreTopic(t);
    if (score >= 4) {
      candidates.push({ ...t, score, reasons });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  console.log(`scanned ${rows.length} topics`);
  console.log(`${candidates.length} suspect spam (score >= 4)\n`);

  console.log('Top 30 by score:');
  console.log('━'.repeat(120));
  for (const c of candidates.slice(0, 30)) {
    console.log(
      String(c.score).padStart(2),
      '│',
      String(c.id).padEnd(6),
      '│',
      c.title.slice(0, 62).padEnd(62),
      '│',
      (c.last_poster_username ?? '?').padEnd(20),
      '│',
      c.reasons.join(', '),
    );
  }
  console.log('━'.repeat(120));
  console.log('\nA quiet-engagement flag here is a "worth a human look", not a verdict - none');
  console.log('of these signals are keyword-based. Confirmed spam goes in lib/refusals.ts:');
  console.log('SPAM_TOPIC_IDS (or SPAM_TITLE_PATTERNS for a recurring shape), then');
  console.log('`npx tsx scripts/sync-forum.ts` sweeps it out on its own next run.');

  // Also surface a one-line summary suitable for a cron tail.
  console.log(`\n[audit-forum-spam] ${candidates.length} suspects, top score ${candidates[0]?.score ?? 0}, top title "${(candidates[0]?.title ?? '').slice(0, 60)}"`);
}

main();
