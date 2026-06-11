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
  // Lowercased filenames already written, for -2/-3 collision suffixes
  // (ADR 0002 #13).
  usedFilenames: string[];
}

// Hard batch cap (ADR 0002 #7).
export const BATCH_MAX_ITEMS = 200;

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
    usedFilenames: [],
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function batchFolderName(now: Date): string {
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
  } else {
    next.failures = [...next.failures, { url, error: outcome.error }];
  }
  next.nextIndex += 1;
  if (next.nextIndex >= next.urls.length) next.status = 'done';
  return { job: next, filename };
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
  return { ...job, status: 'running' };
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
