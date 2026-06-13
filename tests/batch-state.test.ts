import { describe, it, expect } from 'vitest';
import {
  BATCH_MAX_ITEMS,
  LEDGER_CAP,
  appendToLedger,
  appendUrls,
  cancelJob,
  createJob,
  currentUrl,
  normalizeStatusUrl,
  pauseJob,
  recordResult,
  resumeJob,
  statusIdOf,
  uniqueFilename,
  type BatchJob,
} from '../src/background/batch-state';

const NOW = new Date(2026, 5, 11, 14, 30, 52);

describe('normalizeStatusUrl', () => {
  it('strips sub-paths beyond /status/<id>', () => {
    expect(normalizeStatusUrl('https://x.com/user/status/123/photo/1')).toBe(
      'https://x.com/user/status/123'
    );
    expect(normalizeStatusUrl('https://x.com/user/status/123/history')).toBe(
      'https://x.com/user/status/123'
    );
  });

  it('drops query and hash', () => {
    expect(normalizeStatusUrl('https://x.com/user/status/123?s=20#xclipper=1')).toBe(
      'https://x.com/user/status/123'
    );
  });

  it('rejects non-status and non-x.com URLs', () => {
    expect(normalizeStatusUrl('https://x.com/user')).toBeNull();
    expect(normalizeStatusUrl('https://example.com/user/status/123')).toBeNull();
    expect(normalizeStatusUrl('not a url')).toBeNull();
  });
});

describe('statusIdOf', () => {
  it('extracts the numeric status id', () => {
    expect(statusIdOf('https://x.com/a/status/42#xclipper=batch')).toBe('42');
    expect(statusIdOf('https://x.com/a')).toBeNull();
  });
});

describe('createJob', () => {
  it('normalizes, dedupes, and records invalid URLs as failures', () => {
    const job = createJob(
      [
        'https://x.com/a/status/1',
        'https://x.com/a/status/1/photo/1', // dupe of the first after normalization
        'https://x.com/b/status/2',
        'https://x.com/not-a-status',
      ],
      NOW
    );
    expect(job.urls).toEqual(['https://x.com/a/status/1', 'https://x.com/b/status/2']);
    expect(job.failures).toEqual([
      { url: 'https://x.com/not-a-status', error: 'Not an x.com status URL' },
    ]);
    expect(job.status).toBe('running');
    expect(job.nextIndex).toBe(0);
  });

  it('caps the queue at BATCH_MAX_ITEMS', () => {
    const urls = Array.from(
      { length: BATCH_MAX_ITEMS + 50 },
      (_, i) => `https://x.com/u/status/${i + 1}`
    );
    const job = createJob(urls, NOW);
    expect(job.urls).toHaveLength(BATCH_MAX_ITEMS);
  });

  it('derives the folder name from the start time', () => {
    expect(createJob([], NOW).folder).toBe('xclipper-batch-20260611-143052');
  });
});

describe('recordResult', () => {
  const twoItemJob = (): BatchJob =>
    createJob(['https://x.com/a/status/1', 'https://x.com/b/status/2'], NOW);

  it('advances on success and returns the filename to write', () => {
    const { job, filename } = recordResult(twoItemJob(), {
      success: true,
      filename: 'a-1.md',
    });
    expect(filename).toBe('a-1.md');
    expect(job.completed).toBe(1);
    expect(job.nextIndex).toBe(1);
    expect(job.status).toBe('running');
    expect(currentUrl(job)).toBe('https://x.com/b/status/2');
  });

  it('dedupes colliding filenames case-insensitively', () => {
    const first = recordResult(twoItemJob(), { success: true, filename: 'Same.md' });
    const second = recordResult(first.job, { success: true, filename: 'same.md' });
    expect(second.filename).toBe('same-2.md');
  });

  it('records failures against the current URL and continues', () => {
    const { job } = recordResult(twoItemJob(), { success: false, error: 'Timed out' });
    expect(job.failures).toEqual([{ url: 'https://x.com/a/status/1', error: 'Timed out' }]);
    expect(job.completed).toBe(0);
    expect(job.nextIndex).toBe(1);
    expect(job.status).toBe('running');
  });

  it('marks the job done after the last item and clears timers', () => {
    const first = recordResult(twoItemJob(), { success: true, filename: 'a.md' });
    const second = recordResult(first.job, { success: true, filename: 'b.md' });
    expect(second.job.status).toBe('done');
    expect(second.job.deadline).toBeUndefined();
    expect(second.job.nextDispatchAt).toBeUndefined();
    expect(currentUrl(second.job)).toBeUndefined();
  });

  it('is a no-op on a non-running job', () => {
    const cancelled = cancelJob(twoItemJob());
    const { job, filename } = recordResult(cancelled, { success: true, filename: 'a.md' });
    expect(job).toBe(cancelled);
    expect(filename).toBeUndefined();
  });

  it('counts consecutive failures and resets the run on success', () => {
    const job = createJob(
      ['https://x.com/a/status/1', 'https://x.com/b/status/2', 'https://x.com/c/status/3'],
      NOW
    );
    const f1 = recordResult(job, { success: false, error: 'Timed out' });
    expect(f1.job.consecutiveFailures).toBe(1);
    const f2 = recordResult(f1.job, { success: false, error: 'Timed out' });
    expect(f2.job.consecutiveFailures).toBe(2);
    const ok = recordResult(f2.job, { success: true, filename: 'c.md' });
    expect(ok.job.consecutiveFailures).toBe(0);
  });
});

describe('cancelJob', () => {
  it('stops the job and clears timers', () => {
    const job = cancelJob({
      ...createJob(['https://x.com/a/status/1'], NOW),
      awaitingResult: true,
      deadline: 123,
      nextDispatchAt: 456,
    });
    expect(job.status).toBe('cancelled');
    expect(job.awaitingResult).toBe(false);
    expect(job.deadline).toBeUndefined();
    expect(job.nextDispatchAt).toBeUndefined();
  });
});

describe('pauseJob / resumeJob', () => {
  it('pauses a running job, clearing the in-flight item state', () => {
    const job = pauseJob({
      ...createJob(['https://x.com/a/status/1'], NOW),
      awaitingResult: true,
      deadline: 123,
      nextDispatchAt: 456,
    });
    expect(job.status).toBe('paused');
    expect(job.awaitingResult).toBe(false);
    expect(job.deadline).toBeUndefined();
    expect(job.nextDispatchAt).toBeUndefined();
  });

  it('resumes a paused job at the same item', () => {
    const paused = pauseJob(createJob(['https://x.com/a/status/1'], NOW));
    const resumed = resumeJob(paused);
    expect(resumed.status).toBe('running');
    expect(resumed.nextIndex).toBe(0);
    expect(currentUrl(resumed)).toBe('https://x.com/a/status/1');
  });

  it('clears the auto-pause reason and failure run on resume', () => {
    const paused = {
      ...pauseJob(createJob(['https://x.com/a/status/1'], NOW)),
      pauseReason: 'X is rate-limiting',
      consecutiveFailures: 5,
    };
    const resumed = resumeJob(paused);
    expect(resumed.pauseReason).toBeUndefined();
    expect(resumed.consecutiveFailures).toBe(0);
  });

  it('does not pause/resume jobs in other states', () => {
    const done = cancelJob(createJob(['https://x.com/a/status/1'], NOW));
    expect(pauseJob(done)).toBe(done);
    expect(resumeJob(done)).toBe(done);
    const running = createJob(['https://x.com/a/status/1'], NOW);
    expect(resumeJob(running)).toBe(running);
  });
});

describe('appendToLedger', () => {
  it('appends new ids and skips duplicates', () => {
    const one = appendToLedger([], '1');
    expect(one).toEqual(['1']);
    expect(appendToLedger(one, '1')).toBe(one);
    expect(appendToLedger(one, '2')).toEqual(['1', '2']);
  });

  it('drops the oldest entries past the cap', () => {
    const full = Array.from({ length: LEDGER_CAP }, (_, i) => String(i));
    const next = appendToLedger(full, 'newest');
    expect(next).toHaveLength(LEDGER_CAP);
    expect(next[0]).toBe('1');
    expect(next[next.length - 1]).toBe('newest');
  });
});

describe('uniqueFilename', () => {
  it('returns the name unchanged when unused', () => {
    expect(uniqueFilename([], 'foo.md')).toBe('foo.md');
  });

  it('suffixes -2, -3… before the extension on collision', () => {
    expect(uniqueFilename(['foo.md'], 'foo.md')).toBe('foo-2.md');
    expect(uniqueFilename(['foo.md', 'foo-2.md'], 'foo.md')).toBe('foo-3.md');
  });

  it('handles names without an extension', () => {
    expect(uniqueFilename(['foo'], 'foo')).toBe('foo-2');
  });
});

describe('appendUrls', () => {
  const u = (id: string) => `https://x.com/user/status/${id}`;

  it('appends new normalized items not already queued', () => {
    const job = createJob([u('1'), u('2')], NOW);
    const { job: next, added } = appendUrls(job, [u('3'), u('4')], new Set());
    expect(added).toBe(2);
    expect(next.urls).toEqual([u('1'), u('2'), u('3'), u('4')]);
  });

  it('skips items already in the queue (by status id) and exported ids', () => {
    const job = createJob([u('1'), u('2')], NOW);
    const { job: next, added } = appendUrls(
      job,
      [u('2'), u('3'), u('4')],
      new Set(['4'])
    );
    expect(added).toBe(1); // 2 already queued, 4 already exported
    expect(next.urls).toEqual([u('1'), u('2'), u('3')]);
  });

  it('skips non-status urls and dedupes within the additions', () => {
    const job = createJob([u('1')], NOW);
    const { job: next, added } = appendUrls(
      job,
      ['not a url', u('2'), u('2')],
      new Set()
    );
    expect(added).toBe(1);
    expect(next.urls).toEqual([u('1'), u('2')]);
  });

  it('returns the job unchanged when nothing is new', () => {
    const job = createJob([u('1')], NOW);
    const result = appendUrls(job, [u('1')], new Set());
    expect(result.added).toBe(0);
    expect(result.job).toBe(job);
  });

  it('respects the hard item cap', () => {
    const many = Array.from({ length: BATCH_MAX_ITEMS }, (_, i) => u(`${i}`));
    const job = createJob(many, NOW);
    const result = appendUrls(job, [u('9001'), u('9002')], new Set());
    expect(result.added).toBe(0);
    expect(result.job.urls).toHaveLength(BATCH_MAX_ITEMS);
  });

  it('is a no-op once the job is no longer running or paused', () => {
    const done = cancelJob(createJob([u('1')], NOW));
    const result = appendUrls(done, [u('2')], new Set());
    expect(result.added).toBe(0);
    expect(result.job).toBe(done);
  });
});
