import { describe, expect, it } from 'vitest';
import { MAX_DELIVERABLE_BYTES, confirmMessage, fitDeliverable, isUnreadableRepo, nextStep, unreadableRepoMessage, withChanges, type AssignmentRow } from '@/lib/agent-market';

const row = (over: { assignment?: Partial<AssignmentRow['assignment']>; latestMessage?: AssignmentRow['latestMessage'] } = {}): AssignmentRow => ({
  assignment: { assignmentId: 'a1', status: 'in_progress', startedAt: null, submittedAt: null, deliverableUrl: null, slaDeadlineAt: '2026-11-05T12:00:00Z', ...over.assignment },
  job: { title: 'Migrate', description: 'https://github.com/acme/relayer' },
  latestMessage: over.latestMessage ?? null,
});
const buyer = (body: string, createdAt = '2026-11-04T10:00:00Z') => ({ body, createdAt, senderSide: 'buyer', truncated: false });
const own = (body: string) => ({ body, createdAt: '2026-11-04T09:00:00Z', senderSide: 'worker', truncated: false });

describe('what the worker does with an assignment', () => {
  it('works a fresh hire once', () => {
    expect(nextStep(row())).toEqual({ kind: 'work', mark: 'a1:fresh' });
  });

  it('works again when the buyer answers its question before any delivery, and not on its own message', () => {
    expect(nextStep(row({ assignment: { startedAt: '2026-11-04T09:00:00Z' }, latestMessage: buyer('here: https://github.com/acme/relayer') }))).toEqual({ kind: 'work', mark: 'a1:2026-11-04T10:00:00Z' });
    expect(nextStep(row({ assignment: { startedAt: '2026-11-04T09:00:00Z' }, latestMessage: own('To start I need the repository') }))).toEqual({ kind: 'work', mark: 'a1:fresh' });
  });

  it('redoes a delivery when the buyer requests changes, with the feedback, and leaves a delivered one alone', () => {
    const submitted = { startedAt: '2026-11-04T09:00:00Z', submittedAt: '2026-11-04T09:05:00Z' };
    expect(nextStep(row({ assignment: submitted, latestMessage: buyer('also fix scripts/') }))).toEqual({ kind: 'work', mark: 'a1:2026-11-04T10:00:00Z', feedback: 'also fix scripts/' });
    expect(nextStep(row({ assignment: submitted, latestMessage: own('Delivered.') }))).toEqual({ kind: 'skip' });
  });
});

describe('what the buyer reads', () => {
  const repo = { owner: 'acme', repo: 'relayer', branch: 'dev', url: 'https://github.com/acme/relayer' };

  it('confirms the repository, the scope and the time in one message', () => {
    const m = confirmMessage(repo, '2026-11-05T12:00:00Z', false);
    expect(m).toContain('https://github.com/acme/relayer (branch dev)');
    expect(m).toContain('up to 12 files');
    expect(m).toContain('Thu, 05 Nov 2026 12:00:00 GMT');
    expect(confirmMessage(repo, null, true)).toMatch(/^Got your request for changes/);
  });

  it('opens a later version with what changed, quoting the request', () => {
    expect(withChanges('# Report', 'also fix\nscripts/')).toBe('## What changed\n\nThis version re-ran the migration with your request:\n\n> also fix\n> scripts/\n\n# Report');
  });

  it('keeps a deliverable inside the marketplace limit and hands the rest over as a file', () => {
    expect(fitDeliverable('# Short')).toEqual({ markdown: '# Short', overflow: null });
    const long = `# Report\n${'| `a.ts` | 1 | 0 | migrated |\n'.repeat(20_000)}`;
    const fit = fitDeliverable(long);
    expect(Buffer.byteLength(fit.markdown)).toBeLessThanOrEqual(MAX_DELIVERABLE_BYTES);
    expect(fit.markdown).toContain('the full report is attached as nearpedia-migration-report.md');
    expect(fit.overflow).toBe(long);
  });
});

describe('a repository the worker cannot clone', () => {
  it('recognises what git prints for a private or missing repository and a missing branch', () => {
    expect(isUnreadableRepo("Command failed: git clone\nfatal: could not read Username for 'https://github.com': terminal prompts disabled")).toBe(true);
    expect(isUnreadableRepo("remote: Repository not found.\nfatal: repository 'https://github.com/o/r.git/' not found")).toBe(true);
    expect(isUnreadableRepo('warning: Could not find remote branch nope to clone.\nfatal: Remote branch nope not found in upstream origin')).toBe(true);
  });

  it('leaves other failures to the retry path', () => {
    expect(isUnreadableRepo('Command failed: git clone\nfatal: unable to access: Could not resolve host: github.com')).toBe(false);
    expect(isUnreadableRepo('NEARAI_API_KEY is not set')).toBe(false);
    expect(isUnreadableRepo('migration guide 503')).toBe(false);
  });

  it('asks the buyer for a public link, naming the branch when there is one', () => {
    const repo = { owner: 'o', repo: 'r', branch: null, url: 'https://github.com/o/r' };
    expect(unreadableRepoMessage(repo)).toBe('I could not read https://github.com/o/r: private, missing, or branch not found. Send a public link and I will start again.');
    expect(unreadableRepoMessage({ ...repo, branch: 'dev' })).toContain('https://github.com/o/r/tree/dev:');
  });
});
