import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { admit, countOversized, normaliseReport, MAX_BODY_BYTES } from '@/lib/csp-intake';

export const dynamic = 'force-dynamic';

/**
 * CSP violation report endpoint.
 *
 * Browsers POST a JSON body in the W3C reporting format
 * (`{ "csp-report": { ... } }`) when a directive is violated. We
 * persist the essentials so a real attack or a self-inflicted
 * violation (new third-party dependency we forgot to allow) is
 * visible in /api/metrics, which publishes a count for Prometheus to alert on.
 *
 * Add `report-uri /api/csp-report` to the policy in middleware.ts
 * once we're confident this endpoint works reliably - it's wired
 * but not advertised in the policy yet so we can verify on staging
 * first.
 */

interface CspReportV1 {
  'csp-report'?: {
    'document-uri'?: string;
    'violated-directive'?: string;
    'blocked-uri'?: string;
    'source-file'?: string;
    'line-number'?: number;
  };
}

/**
 * Always 204, whatever happens inside.
 *
 * The caller is a browser posting a report it was told to post, with nowhere
 * to show an error and no reason to retry. A status that varies with what we
 * did would also tell an unfriendly caller which reports get stored, which is
 * exactly the map needed to flood past the limits.
 */
const ACCEPTED = () => new NextResponse(null, { status: 204 });

export async function POST(request: Request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    countOversized();
    return ACCEPTED();
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return ACCEPTED();
  }
  // Checked again on the real bytes: content-length can be absent under
  // chunked encoding, and it can lie.
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    countOversized();
    return ACCEPTED();
  }

  let body: CspReportV1;
  try {
    body = JSON.parse(text) as CspReportV1;
  } catch {
    return ACCEPTED();
  }

  const fields = normaliseReport(body['csp-report']);
  if (admit(fields) !== 'store') return ACCEPTED();

  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO csp_violation_log (
        timestamp, document_uri, violated_directive, blocked_uri,
        source_file, line_number
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      Date.now(),
      fields.document_uri,
      fields.violated_directive,
      fields.blocked_uri,
      fields.source_file,
      fields.line_number,
    );
  } catch {
    // Table missing on a stale DB - don't 500 the browser. CSP reports
    // are best-effort observability, not user-visible.
  }
  return ACCEPTED();
}
