'use client';

import { useState, useId } from 'react';
import type { FormEvent } from 'react';
import { SuccessAnimation } from '@/components/success-animation';

type Status = 'idle' | 'sending' | 'sent' | 'error';

interface FormErrors {
  name?: string;
  email?: string;
  subject?: string;
  message?: string;
}

const MAX_NAME = 100;
const MAX_SUBJECT = 200;
const MIN_MESSAGE = 10;
const MAX_MESSAGE = 5000;

function validateEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function ContactForm() {
  const ids = {
    name: useId(),
    email: useId(),
    subject: useId(),
    message: useId(),
    website: useId(),
  };

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);

  function validate(): boolean {
    const next: FormErrors = {};
    if (!name.trim()) next.name = 'Name is required';
    else if (name.length > MAX_NAME) next.name = `Max ${MAX_NAME} characters`;

    if (!email.trim()) next.email = 'Email is required';
    else if (!validateEmail(email)) next.email = 'Invalid email format';

    if (!subject.trim()) next.subject = 'Subject is required';
    else if (subject.length > MAX_SUBJECT) next.subject = `Max ${MAX_SUBJECT} characters`;

    if (!message.trim()) next.message = 'Message is required';
    else if (message.trim().length < MIN_MESSAGE) next.message = `Message too short (min ${MIN_MESSAGE} characters)`;
    else if (message.length > MAX_MESSAGE) next.message = `Max ${MAX_MESSAGE} characters`;

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;

    setStatus('sending');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, subject, message, website }),
      });

      if (res.ok) {
        setStatus('sent');
        setName('');
        setEmail('');
        setSubject('');
        setMessage('');
        setWebsite('');
        setErrors({});
        return;
      }

      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        setStatus('error');
        setServerError(data.error ?? 'Too many requests. Please try again later.');
        return;
      }

      const data = await res.json().catch(() => ({}));
      setStatus('error');
      setServerError(data.error ?? 'Something went wrong. Please try again.');
    } catch {
      setStatus('error');
      setServerError('Network error. Please check your connection and try again.');
    }
  }

  if (status === 'sent') {
    return (
      <section aria-live="polite" className="contact-form-success">
        <SuccessAnimation />
        <h2>Message sent</h2>
        <p>
          Thanks - we received your message and will get back to you at <strong>{email || 'your email'}</strong>{' '}
          within 1-3 business days.
        </p>
        <button
          type="button"
          className="pg-btn pg-btn--line"
          onClick={() => setStatus('idle')}
        >
          Send another message
        </button>
      </section>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="contact-form" noValidate>
      <div className="contact-form-row">
        <label htmlFor={ids.name}>Name *</label>
        <input
          id={ids.name}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_NAME}
          required
          autoComplete="name"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? `${ids.name}-err` : undefined}
        />
        {errors.name && <span id={`${ids.name}-err`} className="contact-form-error">{errors.name}</span>}
      </div>

      <div className="contact-form-row">
        <label htmlFor={ids.email}>Email *</label>
        <input
          id={ids.email}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? `${ids.email}-err` : undefined}
        />
        {errors.email && <span id={`${ids.email}-err`} className="contact-form-error">{errors.email}</span>}
      </div>

      <div className="contact-form-row">
        <label htmlFor={ids.subject}>Subject *</label>
        <input
          id={ids.subject}
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={MAX_SUBJECT}
          required
          aria-invalid={Boolean(errors.subject)}
          aria-describedby={errors.subject ? `${ids.subject}-err` : undefined}
        />
        {errors.subject && <span id={`${ids.subject}-err`} className="contact-form-error">{errors.subject}</span>}
      </div>

      <div className="contact-form-row">
        <label htmlFor={ids.message}>Message *</label>
        <textarea
          id={ids.message}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={MAX_MESSAGE}
          required
          rows={8}
          aria-invalid={Boolean(errors.message)}
          aria-describedby={errors.message ? `${ids.message}-err` : undefined}
        />
        <div className="contact-form-meta">
          <span>{message.length} / {MAX_MESSAGE}</span>
        </div>
        {errors.message && <span id={`${ids.message}-err`} className="contact-form-error">{errors.message}</span>}
      </div>

      <div className="contact-form-honeypot" aria-hidden="true">
        <label htmlFor={ids.website}>Website (leave blank)</label>
        <input
          id={ids.website}
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {serverError && (
        <div className="contact-form-server-error" role="alert">
          {serverError}
        </div>
      )}

      <div className="contact-form-actions">
        <button
          type="submit"
          disabled={status === 'sending'}
          className="pg-btn"
        >
          {status === 'sending' ? 'Sending…' : 'Send message'}
        </button>
      </div>

      <p className="contact-form-privacy">
        Your message and email address are sent to our inbox only. We do not store them
        in any user-facing database. See <a href="/privacy">Privacy</a> for details.
      </p>
    </form>
  );
}
