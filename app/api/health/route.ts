import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isLocalCall } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  uptime_s: number;
  db: {
    ok: boolean;
    docs: number;
    last_sync: string | null;
    embeddings: number;
  };
  build_time?: string;
  version?: string;
  duration_ms?: number;
  /** Git commit this bundle was built from. Local callers only; see isLocalCall. */
  build_commit?: string | null;
  /** Whether a build id exists at all, for public callers. */
  build_id?: 'set' | 'unset';
}

const START = Date.now();

// The watchdog restarts on a 10s curl timeout with zero diagnostic trace, and
// better-sqlite3 is fully synchronous - one slow query on any OTHER route
// blocks this handler too, since it shares the same single-threaded event
// loop. A 2026-09-01 incident (5 watchdog-triggered restarts, 05:24-06:08
// UTC) left no way to tell "genuinely down" from "briefly starved" apart,
// because nothing here timed itself. Logging only past this threshold, not
// every call, since /api/health is polled every minute by the watchdog alone.
const SLOW_MS = 500;

export async function GET(req: Request) {
  const t0 = Date.now();
  const response: HealthResponse = {
    status: 'ok',
    uptime_s: Math.floor((Date.now() - START) / 1000),
    db: { ok: false, docs: 0, last_sync: null, embeddings: 0 },
    build_time: process.env.BUILD_TIME,
    // package.json's version isn't maintained (semver tags are), so this
    // reported 0.1.0 forever and answered nothing. The commit the bundle was
    // built from is the fact an operator actually needs, and
    // scripts/check-deployed.ts compares it to HEAD.
    version: process.env.npm_package_version,
    // The exact commit is a fingerprint: it maps a running instance to a
    // public source tree, which is a shortcut for anyone looking for a known
    // issue in a specific build. It stays for callers on the box - the public
    // answer says only whether a build id is present.
    build_commit: isLocalCall(req) ? (process.env.BUILD_COMMIT || null) : undefined,
    build_id: process.env.BUILD_COMMIT ? 'set' : 'unset',
  };
  const steps: Record<string, number> = {};
  const timed = <T>(label: string, fn: () => T): T => {
    const s = Date.now();
    const out = fn();
    steps[label] = Date.now() - s;
    return out;
  };

  try {
    const db = timed('db_open', () => getDb());
    response.db.ok = true;
    response.db.docs = timed('docs', () => (db.prepare('SELECT COUNT(*) as c FROM doc_pages').get() as { c: number }).c);
    response.db.embeddings = timed('embeddings', () => (db.prepare('SELECT COUNT(*) as c FROM embedding_chunks').get() as { c: number }).c);
    const lastSync = timed('last_sync', () => db.prepare("SELECT MAX(ran_at) as t FROM sync_log WHERE status = 'success'").get() as { t: string | null });
    response.db.last_sync = lastSync.t;

    // Degrade if last sync is older than 24h
    if (lastSync.t) {
      const ageMs = Date.now() - new Date(lastSync.t).getTime();
      if (ageMs > 86400000) response.status = 'degraded';
    }
  } catch (err) {
    response.status = 'down';
    response.duration_ms = Date.now() - t0;
    console.error(`[health] down after ${response.duration_ms}ms:`, err instanceof Error ? err.message : err);
    return NextResponse.json(response, { status: 503 });
  }

  response.duration_ms = Date.now() - t0;
  if (response.duration_ms > SLOW_MS) {
    console.warn(`[health] slow response: ${response.duration_ms}ms (${Object.entries(steps).map(([k, v]) => `${k}=${v}ms`).join(' ')})`);
  }

  return NextResponse.json(response, {
    status: response.status === 'down' ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
