// Pure state for a batch export job (ADR 0002, Phase A). All chrome.* side
// effects live in batch.ts; keeping the transitions pure makes them
// unit-testable without extension API mocks.

export interface BatchFailure {
  url: string;
  error: string;
}

export interface BatchJob {
  id: string;
  status: 'running' | 'paused' | 'done' | 'cancelled';
  // Surface that launched the job; the popup scopes progress display to it.
  origin?: 'bookmarks' | 'profile' | 'selection' | 'likes' | 'timeline';
  // Profile owner's handle (only when origin === 'profile'); lets the popup
  // offer "add to queue" on the same profile but not a different one.
  handle?: string;
  // File format + grouping snapshotted at job start (default 'md'/'separate').
  format?: 'md' | 'txt' | 'html' | 'json' | 'csv';
  output?: 'separate' | 'both' | 'combined';
  // Normalized, deduped status permalinks.
  urls: string[];
  // Index of the item currently being processed (or next to dispatch).
  nextIndex: number;
  // Downloads subfolder all of this job's files land in.
  folder: string;
  workerTabId?: number;
  workerWindowId?: number;
  // True once the current item's URL has been loaded in the worker tab and
  // we're waiting on the content script's BATCH_ITEM_RESULT.
  awaitingResult: boolean;
  // Epoch ms — the current item is failed as timed out past this.
  deadline?: number;
  // Epoch ms — earliest time the next item may be dispatched (politeness
  // throttle, ADR 0002 #7).
  nextDispatchAt?: number;
  completed: number;
  failures: BatchFailure[];
  // Failures since the last success — a run of these means something systemic
  // (rate limit, interstitial) rather than individual bad tweets, so the
  // orchestrator auto-pauses past a threshold (ADR 0002 #7).
  consecutiveFailures: number;
  // Why the job auto-paused, when it did (login/rate-limit wall or a failure
  // run). Surfaced in the popup; cleared on resume.
  pauseReason?: string;
  // Lowercased filenames already written, for -2/-3 collision suffixes
  // (ADR 0002 #13).
  usedFilenames: string[];
}

// Hard batch cap (ADR 0002 #7).
export const BATCH_MAX_ITEMS = 200;

// Ledger of status ids already exported by past batch jobs, persisted in
// chrome.storage.local. startBatch skips these so re-running on a longer
// scroll of the same bookmarks doesn't duplicate files; the popup's Reset
// control clears it. Pure helpers here; storage I/O lives in batch.ts.
export const EXPORTED_LEDGER_KEY = 'xclipper_batch_exported';
export const LEDGER_CAP = 5000;

// Fast Batch only: ids written as partial (rate-limited) stubs — un-ledgered so
// a re-run retries them, and expanded FIRST next run so a stable feed order
// can't starve the same tail forever (issue #81). Cleared by the same Reset.
export const INCOMPLETE_LEDGER_KEY = 'xclipper_fast_incomplete';

// Fast Batch only: per-source cursor for Resume pagination — where the last
// Resume run left off, so the next continues instead of re-scanning the feed
// from the top (issue #83). Shape { [source]: cursor }. Cleared by Reset history.
export const RESUME_CURSOR_KEY = 'xclipper_fast_resume';

export function appendToLedger(ledger: string[], id: string): string[] {
  if (ledger.includes(id)) return ledger;
  const next = [...ledger, id];
  return next.length > LEDGER_CAP ? next.slice(next.length - LEDGER_CAP) : next;
}

// Strip any path beyond /status/<id> (e.g. /history, /photo/1) and drop any
// query/hash, so the worker tab always loads the canonical permalink.
export function normalizeStatusUrl(url: string): string | null {
  const m = url.match(/^(https?:\/\/(?:www\.)?x\.com\/[^/]+\/status\/\d+)/);
  return m ? m[1] : null;
}

export function statusIdOf(url: string): string | null {
  const m = url.match(/\/status\/(\d+)/);
  return m ? m[1] : null;
}

export function createJob(rawUrls: string[], now: Date): BatchJob {
  const failures: BatchFailure[] = [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of rawUrls) {
    const normalized = normalizeStatusUrl(raw);
    if (!normalized) {
      failures.push({ url: raw, error: 'Not an x.com status URL' });
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }
  return {
    id: `batch-${now.getTime()}`,
    status: 'running',
    urls: urls.slice(0, BATCH_MAX_ITEMS),
    nextIndex: 0,
    folder: batchFolderName(now),
    awaitingResult: false,
    completed: 0,
    failures,
    consecutiveFailures: 0,
    usedFilenames: [],
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function batchFolderName(now: Date): string {
  return (
    `xclipper-batch-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export function currentUrl(job: BatchJob): string | undefined {
  return job.status === 'running' ? job.urls[job.nextIndex] : undefined;
}

export type ItemOutcome =
  | { success: true; filename: string }
  | { success: false; error: string };

// Advance past the current item. On success, returns the collision-deduped
// filename the caller should write. The job flips to 'done' after the last
// item.
export function recordResult(
  job: BatchJob,
  outcome: ItemOutcome
): { job: BatchJob; filename?: string } {
  const url = currentUrl(job);
  if (url === undefined) return { job };

  const next: BatchJob = {
    ...job,
    awaitingResult: false,
    deadline: undefined,
    nextDispatchAt: undefined,
  };
  let filename: string | undefined;
  if (outcome.success) {
    filename = uniqueFilename(next.usedFilenames, outcome.filename);
    next.usedFilenames = [...next.usedFilenames, filename.toLowerCase()];
    next.completed += 1;
    next.consecutiveFailures = 0;
  } else {
    next.failures = [...next.failures, { url, error: outcome.error }];
    next.consecutiveFailures += 1;
  }
  next.nextIndex += 1;
  if (next.nextIndex >= next.urls.length) next.status = 'done';
  return { job: next, filename };
}

// Add freshly-loaded items to a live job's queue — used when the user scrolls
// in more posts while a same-source job is running, instead of waiting for it
// to finish or stopping and restarting. Normalizes, then skips anything
// already queued/processed in this job or already exported by a past job, and
// respects the hard cap. Returns the new job and the number actually added.
export function appendUrls(
  job: BatchJob,
  rawUrls: string[],
  exportedIds: Set<string>
): { job: BatchJob; added: number } {
  if (job.status !== 'running' && job.status !== 'paused') return { job, added: 0 };
  const seen = new Set<string>();
  for (const u of job.urls) {
    const id = statusIdOf(u);
    if (id) seen.add(id);
  }
  const room = BATCH_MAX_ITEMS - job.urls.length;
  if (room <= 0) return { job, added: 0 };
  const additions: string[] = [];
  for (const raw of rawUrls) {
    const normalized = normalizeStatusUrl(raw);
    if (!normalized) continue;
    const id = statusIdOf(normalized);
    if (!id || seen.has(id) || exportedIds.has(id)) continue;
    seen.add(id);
    additions.push(normalized);
    if (additions.length >= room) break;
  }
  if (additions.length === 0) return { job, added: 0 };
  return { job: { ...job, urls: [...job.urls, ...additions] }, added: additions.length };
}

export function cancelJob(job: BatchJob): BatchJob {
  return {
    ...job,
    status: 'cancelled',
    awaitingResult: false,
    deadline: undefined,
    nextDispatchAt: undefined,
  };
}

// Pausing abandons the in-flight item (a late result is dropped by the
// orchestrator's status guard); resuming re-dispatches it from scratch.
export function pauseJob(job: BatchJob): BatchJob {
  if (job.status !== 'running') return job;
  return {
    ...job,
    status: 'paused',
    awaitingResult: false,
    deadline: undefined,
    nextDispatchAt: undefined,
  };
}

export function resumeJob(job: BatchJob): BatchJob {
  if (job.status !== 'paused') return job;
  // Clear the auto-pause reason and the failure run so resuming starts clean —
  // otherwise a single post-resume failure could re-trip the threshold pause.
  return { ...job, status: 'running', pauseReason: undefined, consecutiveFailures: 0 };
}

// foo.md → foo-2.md, foo-3.md… until unused. `used` entries are lowercased;
// comparison is case-insensitive so "Foo.md" and "foo.md" collide (the
// downloads folder may sit on a case-insensitive filesystem).
export function uniqueFilename(used: string[], filename: string): string {
  const taken = new Set(used);
  if (!taken.has(filename.toLowerCase())) return filename;
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  for (let i = 2; ; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
