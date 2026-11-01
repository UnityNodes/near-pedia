import type { Metadata } from 'next';
import { ContactForm } from './contact-form';
import { isMailerConfigured } from '@/lib/mailer';
import { LegalPage } from '@/components/reader-shell';
import { SITE } from '@/lib/site.config';

export const metadata: Metadata = {
  title: 'Contact',
  description: `Get in touch with the ${SITE.name} team.`,
};

export default function ContactPage() {
  // No SMTP_USER/SMTP_PASS set -> the form's POST would 503 on every
  // submission. Show the alternative channels instead of a broken form;
  // this flips back to the real form automatically once SMTP is configured,
  // no code change needed.
  const mailerReady = isMailerConfigured();

  return (
    <LegalPage crumb="Contact">
      <header>
        <p className="legal-kicker">CONTACT</p>
        <h1>Get in touch</h1>
        <p className="legal-meta">
          Questions, feedback, broken links, or a CIP we missed - we read everything.
        </p>
      </header>

      <section>
        <h2>Send a message</h2>
        {mailerReady ? (
          <p>
            Use this form for general inquiries, content corrections, GDPR data-subject
            requests, or business questions. We typically reply within 1-3 business days.
          </p>
        ) : (
          <p>
            The message form is temporarily unavailable. For general inquiries, content
            corrections, GDPR data-subject requests, or business questions, please use one
            of the channels below instead.
          </p>
        )}
        <p>
          <strong>Security vulnerabilities?</strong> Please report privately via{' '}
          <a
            href="https://github.com/your-org/nearpedia/security/advisories/new"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub Security Advisories
          </a>{' '}
          (encrypted, audit-trailed).
        </p>
      </section>

      {mailerReady && <ContactForm />}

      <section>
        <h2>Other channels</h2>
        <ul>
          <li>
            Bug reports and feature requests:{' '}
            <a
              href="https://github.com/your-org/nearpedia/issues"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub Issues
            </a>
          </li>
          <li>
            Source code:{' '}
            <a
              href="https://github.com/your-org/nearpedia"
              target="_blank"
              rel="noopener noreferrer"
            >
              github.com/your-org/nearpedia
            </a>
          </li>
        </ul>
      </section>
    </LegalPage>
  );
}
