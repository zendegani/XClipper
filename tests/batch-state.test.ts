import { describe, it, expect } from 'vitest';
import {
  BATCH_MAX_ITEMS,
  cancelJob,
  createJob,
  currentUrl,
  normalizeStatusUrl,
  recordResult,
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
