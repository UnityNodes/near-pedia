import fs from 'node:fs';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { toleranceSecondsBySource } from '../lib/schedule';
import {
  callerDigest, decide, loadDigestDay, loadDigestMessages, loadMessages, loadState, messagesToRemove, openFailures,
  saveDigestDay, saveDigestMessages, saveMessages, saveState, type PagedMessage,
} from '../lib/failure-alerts';
import { deletePage, hasChannel, pagerChannels, sendPage } from '../lib/ops-pager';
import { SITE } from '../lib/site.config';

const QUIET_FILE = process.env.ALERT_QUIET_FILE ?? '/var/run/nearpedia-quiet';
const STATUS_URL = process.env.STATUS_URL ?? SITE.url;

async function removeResolved(messages: PagedMessage[], gone: PagedMessage[]): Promise<{ kept: PagedMessage[]; removed: number }> {
  const channels = pagerChannels();
  const kept: PagedMessage[] = [];
  let removed = 0;
  for (const m of messages) {
    if (!gone.includes(m)) { kept.push(m); continue; }
    const left: string[] = [];
    for (const ref of m.refs) {
      if (!(await deletePage(ref, channels))) left.push(ref);
    }
    if (left.length > 0) kept.push({ ...m, refs: left });
    else removed++;
  }
  return { kept, removed };
}

async function main(): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const scheduled = toleranceSecondsBySource();
  const prev = loadState(db);
  const open = openFailures(db, scheduled, now, new Set(Object.keys(prev?.open ?? {})));
  const decision = decide(prev, open, now, STATUS_URL);
  const digest = callerDigest(db, now, loadDigestDay(db));
  const held = fs.existsSync(QUIET_FILE);
  const channels = pagerChannels();
  const undelivered: string[] = [];

  if (held) {
    if (decision.message || digest.message) console.log('[check-failures] quiet file present, pages held until it is removed');
  } else {
    if (!hasChannel(channels) && (decision.message || digest.message)) {
      console.error('[check-failures] NO OPS CHANNEL CONFIGURED, nobody was told');
    }
    const messages = loadMessages(db);
    let posted: PagedMessage | null = null;
    if (decision.message === null) {
      saveState(db, decision.next, now);
    } else {
      const sent = await sendPage(decision.message, channels);
      if (sent.delivered) {
        console.log(`[check-failures] paged:\n${decision.message}`);
        saveState(db, decision.next, now);
        posted = { refs: sent.refs, keys: decision.keys, reminder: decision.reminder, at: now };
      } else {
        undelivered.push('failure page');
      }
    }
    const openNow = new Set(Object.keys(decision.next.open));
    const gone = messagesToRemove(messages, openNow, posted !== null && posted.reminder);
    const { kept, removed } = await removeResolved(messages, gone);
    if (removed > 0) console.log(`[check-failures] removed ${removed} alert message(s) whose failures are resolved or superseded`);
    saveMessages(db, posted && posted.refs.length > 0 ? [...kept, posted] : kept, now);

    if (digest.message !== null) {
      const sent = await sendPage(digest.message, channels);
      if (sent.delivered) {
        saveDigestDay(db, digest.day, now);
        const previous = loadDigestMessages(db);
        const { kept } = await removeResolved(previous, previous);
        const current: PagedMessage[] = sent.refs.length > 0 ? [{ refs: sent.refs, keys: [], reminder: false, at: now }] : [];
        saveDigestMessages(db, [...kept, ...current], now);
      } else {
        undelivered.push('caller digest');
      }
    }
  }

  console.log(`[check-failures] ${open.length} open failure(s) across ${scheduled.size} scheduled source(s) and recent tool events`);
  if (undelivered.length > 0) {
    logRun('check-failures', { status: 'error', items: scheduled.size, error: `not delivered, will retry next tick: ${undelivered.join(', ')}` });
    process.exitCode = 1;
  } else if (held && (decision.message || digest.message)) {
    logRun('check-failures', { status: 'partial', items: scheduled.size, error: `pages held by ${QUIET_FILE}` });
  } else {
    logRun('check-failures', { status: 'success', items: scheduled.size });
  }
}

main().catch(err => {
  console.error(err);
  logRun('check-failures', { status: 'error', items: 0, error: String(err).slice(0, 1000) });
  process.exitCode = 1;
});
