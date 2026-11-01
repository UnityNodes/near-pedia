import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { SITE } from './site.config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  fromName?: string;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST ?? 'smtp.gmail.com';
  // Default 587 (STARTTLS submission) rather than 465 (TLS-on-connect):
  // most VPS providers (Hetzner, OVH, DigitalOcean, AWS EC2 default SG)
  // block outbound port 465 as anti-spam but allow 587. Setting 587 as
  // default avoids a 60-second timeout on the first contact form submit.
  // Override with SMTP_PORT=465 if your provider permits it.
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) return null;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return cachedTransporter;
}

export async function sendMail(msg: MailMessage): Promise<SendResult> {
  const transporter = getTransporter();
  const fromEnv = process.env.SMTP_USER;

  if (!transporter || !fromEnv) {
    console.warn('[mailer] SMTP not configured; message dropped:', { to: msg.to, subject: msg.subject });
    return { ok: false, error: 'SMTP not configured' };
  }

  const fromName = msg.fromName ?? `${SITE.name} Contact`;
  const from = `"${fromName}" <${fromEnv}>`;

  try {
    const info = await transporter.sendMail({
      from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      replyTo: msg.replyTo,
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[mailer] send failed:', message);
    return { ok: false, error: message };
  }
}

export function isMailerConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}
