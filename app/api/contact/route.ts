import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getIdentifiers } from '@/lib/rate-limit';
import { sendMail, isMailerConfigured } from '@/lib/mailer';

export const dynamic = 'force-dynamic';

const MAX_NAME = 100;
const MAX_SUBJECT = 200;
const MIN_MESSAGE = 10;
const MAX_MESSAGE = 5000;

// Contact form is rare - a real user sends maybe 1-2/day. Tighter limits =
// better spam defense without honest-user friction.
const COOLDOWN_MS = 10_000;          // 10s between submissions
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_LIMIT = 3;                 // 3 per hour per IP
const DAY_LIMIT = 10;                 // 10 per day per IP

interface ContactPayload {
  name?: unknown;
  email?: unknown;
  subject?: unknown;
  message?: unknown;
  website?: unknown;                 // honeypot
}

function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

function validateEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function clean(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function logSubmission(opts: {
  ip: string;
  email: string;
  subject: string;
  status: 'sent' | 'spam' | 'rate_limited' | 'invalid' | 'failed';
  error?: string;
}): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO contact_submissions (timestamp, ip, email, subject_excerpt, status, error)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      Date.now(),
      opts.ip,
      opts.email || null,
      opts.subject ? opts.subject.slice(0, 80) : null,
      opts.status,
      opts.error ?? null,
    );
  } catch (err) {
    console.warn('[contact] log failed:', err);
  }
}

function checkContactRateLimit(ip: string, now: number): { ok: true } | { ok: false; reason: string; retryAfter: number } {
  // 'unknown' (no X-Real-IP/CF-Connecting-IP/X-Forwarded-For at all) used to
  // short-circuit the limit entirely - exactly the caller a rate limit exists
  // for. Treat it as an ordinary bucket key instead: every headerless caller
  // shares one bucket, same as any other IP would.
  const key = ip || 'unknown';

  const db = getDb();
  const stmt = db.prepare(
    `SELECT COUNT(*) as c FROM contact_submissions
     WHERE ip = ? AND timestamp >= ? AND status IN ('sent', 'failed')`
  );

  const cooldown = stmt.get(key, now - COOLDOWN_MS) as { c: number };
  if (cooldown.c > 0) {
    return { ok: false, reason: 'Please wait a few seconds between submissions.', retryAfter: 10 };
  }

  const hourly = stmt.get(key, now - HOUR_MS) as { c: number };
  if (hourly.c >= HOUR_LIMIT) {
    return { ok: false, reason: 'Too many submissions in the last hour. Please try again later.', retryAfter: 3600 };
  }

  const daily = stmt.get(key, now - DAY_MS) as { c: number };
  if (daily.c >= DAY_LIMIT) {
    return { ok: false, reason: 'Daily submission limit reached. Please try again tomorrow.', retryAfter: 86400 };
  }

  return { ok: true };
}

export async function POST(req: Request): Promise<NextResponse> {
  const ids = getIdentifiers(req);
  const ip = ids.ip;
  const now = Date.now();

  let body: ContactPayload;
  try {
    body = (await req.json()) as ContactPayload;
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  // Honeypot - silently succeed so bots think it worked.
  const honeypot = clean(body.website);
  if (honeypot.length > 0) {
    logSubmission({ ip, email: clean(body.email), subject: clean(body.subject), status: 'spam', error: 'honeypot filled' });
    return NextResponse.json({ ok: true });
  }

  const name = clean(body.name);
  const email = clean(body.email);
  const subject = clean(body.subject);
  const message = clean(body.message);

  if (!name || name.length > MAX_NAME) {
    return jsonError(400, `Name is required (max ${MAX_NAME} chars).`);
  }
  if (!email || !validateEmail(email)) {
    return jsonError(400, 'Valid email is required.');
  }
  if (!subject || subject.length > MAX_SUBJECT) {
    return jsonError(400, `Subject is required (max ${MAX_SUBJECT} chars).`);
  }
  if (!message || message.length < MIN_MESSAGE) {
    return jsonError(400, `Message too short (min ${MIN_MESSAGE} chars).`);
  }
  if (message.length > MAX_MESSAGE) {
    return jsonError(400, `Message too long (max ${MAX_MESSAGE} chars).`);
  }

  const rl = checkContactRateLimit(ip, now);
  if (!rl.ok) {
    logSubmission({ ip, email, subject, status: 'rate_limited', error: rl.reason });
    return NextResponse.json(
      { error: rl.reason },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  if (!isMailerConfigured()) {
    console.error('[contact] mailer not configured - SMTP_USER/SMTP_PASS missing');
    logSubmission({ ip, email, subject, status: 'failed', error: 'mailer not configured' });
    return jsonError(503, 'Contact form is temporarily unavailable. Please try again later.');
  }

  const to = process.env.CONTACT_RECIPIENT_EMAIL ?? process.env.SMTP_USER!;
  const bodyText = [
    `Name: ${name}`,
    `Email: ${email}`,
    `IP: ${ip}`,
    '',
    '--- Message ---',
    message,
    '',
    '--- Metadata ---',
    `Sent at: ${new Date(now).toISOString()}`,
    `User-Agent: ${req.headers.get('user-agent') ?? 'unknown'}`,
  ].join('\n');

  const result = await sendMail({
    to,
    subject: `[YOURPEDIA Contact] ${subject}`,
    text: bodyText,
    replyTo: `"${name}" <${email}>`,
    fromName: 'YOURPEDIA Contact Form',
  });

  if (!result.ok) {
    logSubmission({ ip, email, subject, status: 'failed', error: result.error });
    return jsonError(502, 'Failed to deliver message. Please try again later.');
  }

  logSubmission({ ip, email, subject, status: 'sent' });
  return NextResponse.json({ ok: true, messageId: result.messageId });
}
