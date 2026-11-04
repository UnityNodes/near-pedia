import { MAX_FILES, type RepoRef } from './migrate-repo';

export const MAX_DELIVERABLE_BYTES = 256 * 1024;
export const REPORT_FILE = 'nearpedia-migration-report.md';
const FEEDBACK_QUOTE_CHARS = 600;
const OVERFLOW_NOTE = `\n\n---\n\nThe report is longer than the marketplace shows in one deliverable: the full report is attached as ${REPORT_FILE}.\n`;

export interface AssignmentRow {
  assignment: { assignmentId: string; status: string; startedAt: string | null; submittedAt: string | null; deliverableUrl: string | null; slaDeadlineAt: string | null };
  job: { title: string; description: string };
  latestMessage: { body?: string; createdAt?: string; senderSide?: string; truncated?: boolean } | null;
}

export type Step = { kind: 'work'; mark: string; feedback?: string } | { kind: 'skip' };

export function nextStep(row: AssignmentRow): Step {
  const id = row.assignment.assignmentId;
  const m = row.latestMessage;
  const fromBuyer = m?.senderSide === 'buyer' && Boolean(m.createdAt);
  if (row.assignment.submittedAt) {
    return fromBuyer ? { kind: 'work', mark: `${id}:${m!.createdAt}`, feedback: m!.body ?? '' } : { kind: 'skip' };
  }
  return { kind: 'work', mark: `${id}:${fromBuyer ? m!.createdAt : 'fresh'}` };
}

export function confirmMessage(repo: RepoRef, deadline: string | null, rework: boolean): string {
  const target = `${repo.url}${repo.branch ? ` (branch ${repo.branch})` : ''}`;
  const by = deadline ? `by ${new Date(deadline).toUTCString()}, usually within a few minutes` : 'within a few minutes';
  if (rework) return `Got your request for changes. I'm re-running ${target} with it; the new version lands here ${by}.`;
  return `Got it. I'm checking ${target} for NEAR code that NEAR deprecated, removed or changed, and rewriting up to ${MAX_FILES} files where the change passes the checks. You get a Markdown report and a patch here ${by}.`;
}

export function withChanges(markdown: string, feedback: string): string {
  const quoted = feedback.slice(0, FEEDBACK_QUOTE_CHARS).split('\n').map((l) => `> ${l}`).join('\n');
  return `## What changed\n\nThis version re-ran the migration with your request:\n\n${quoted}\n\n${markdown}`;
}

export function fitDeliverable(markdown: string): { markdown: string; overflow: string | null } {
  if (Buffer.byteLength(markdown) <= MAX_DELIVERABLE_BYTES) return { markdown, overflow: null };
  const room = MAX_DELIVERABLE_BYTES - Buffer.byteLength(OVERFLOW_NOTE);
  let cut = Buffer.from(markdown).subarray(0, room).toString('utf8').replace(/�$/, '');
  cut = cut.slice(0, Math.max(cut.lastIndexOf('\n'), 0));
  return { markdown: cut + OVERFLOW_NOTE, overflow: markdown };
}
