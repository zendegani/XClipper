import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Document } from '../src/ast/types';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings';

// The Manual orchestrator with chrome mocked down to the downloads it starts:
// the worker tab reports each post's AST, and the background writes its files.

let settings: Settings;

vi.mock('../src/shared/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/shared/settings')>();
  return { ...actual, loadSettings: async () => ({ ...settings }) };
});
vi.mock('../src/shared/review-prompt', () => ({ recordExport: async () => {} }));
vi.mock('../src/background/resolve-video', () => ({ resolveVideoUrls: async () => new Map() }));

const alarmListeners: ((alarm: { name: string }) => void)[] = [];
let downloads: { filename: string; url: string }[] = [];
let session: Record<string, unknown> = {};
let local: Record<string, unknown> = {};

function storageArea(get: () => Record<string, unknown>) {
  return {
    get: async (keys: string | string[]) => {
      const out: Record<string, unknown> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) if (k in get()) out[k] = structuredClone(get()[k]);
      return out;
    },
    set: async (items: Record<string, unknown>) => void Object.assign(get(), structuredClone(items)),
    remove: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete get()[k];
    },
  };
}

const chromeGlobal = (globalThis as unknown as { chrome: Record<string, unknown> }).chrome;
Object.assign(chromeGlobal, {
  storage: {
    ...(chromeGlobal.storage as object),
    local: storageArea(() => local),
    session: storageArea(() => session),
  },
  alarms: {
    create: () => {},
    clear: async () => true,
    onAlarm: { addListener: (fn: (alarm: { name: string }) => void) => alarmListeners.push(fn) },
  },
  tabs: { update: async () => ({}), get: async () => ({ id: 7 }), remove: async () => {}, onRemoved: { addListener: () => {} } },
  windows: { create: async () => ({ id: 1, tabs: [{ id: 7 }] }), remove: async () => {} },
  downloads: {
    download: (opts: { filename: string; url: string }, cb: (id: number) => void) => {
      downloads.push(opts);
      cb(downloads.length);
      queueMicrotask(() => changeListeners.forEach((l) => l({ id: downloads.length, state: { current: 'complete' } })));
    },
    onChanged: {
      addListener: (fn: ChangeListener) => changeListeners.add(fn),
      removeListener: (fn: ChangeListener) => changeListeners.delete(fn),
    },
  },
});
type ChangeListener = (delta: { id: number; state: { current: string } }) => void;
const changeListeners = new Set<ChangeListener>();

const { batchRoutes, initBatch, startBatch } = await import('../src/background/batch');
const { dispatch } = await import('../src/background/router');
initBatch();

function post(id: string, text: string): Document {
  const author = { name: 'Jane', handle: 'jane' };
  const date = '2026-01-02T10:00:00.000Z';
  return {
    version: 1,
    metadata: { type: 'tweet', sourceUrl: `https://x.com/jane/status/${id}`, tweetId: id, author, date },
    body: { type: 'tweet', author, date, tweetId: id, text: [{ type: 'text', value: text }], media: [] },
  };
}

// What the worker tab sends once it has extracted a post: the AST, nothing else.
async function workerReports(doc: Document): Promise<void> {
  const msg = { action: 'BATCH_ITEM_RESULT', url: doc.metadata.sourceUrl, success: true, doc };
  dispatch(batchRoutes, msg, { tab: { id: 7 }, url: doc.metadata.sourceUrl }, () => {});
  await vi.advanceTimersByTimeAsync(2_000);
  for (const l of alarmListeners) l({ name: 'xclipper-batch-watchdog' });
  await vi.advanceTimersByTimeAsync(0);
}

const fileNames = (): string[] => downloads.map((d) => d.filename.split('/').pop() ?? '');
const text = (name: string): string => {
  const d = downloads.find((x) => x.filename.endsWith('/' + name));
  return d ? decodeURIComponent(d.url.slice(d.url.indexOf(',') + 1)) : '';
};

beforeEach(() => {
  vi.useFakeTimers();
  settings = { ...DEFAULT_SETTINGS, filenameTemplate: '{id}' };
  downloads = [];
  session = {};
  local = {};
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Manual batch', () => {
  it('writes each post from the AST the worker tab sends', async () => {
    const a = post('1', 'first post');
    await startBatch([a.metadata.sourceUrl], 'selection');
    await workerReports(a);

    expect(fileNames()).toContain('1.md');
    expect(text('1.md')).toContain('first post');
  });

  it('keeps the settings from the start of the job when they change mid-run', async () => {
    const a = post('1', 'first');
    const b = post('2', 'second');
    await startBatch([a.metadata.sourceUrl, b.metadata.sourceUrl], 'selection');
    await workerReports(a);
    settings = { ...settings, filenameTemplate: '{handle}-{id}', obsidianFriendly: true };
    await workerReports(b);

    expect(fileNames().filter((n) => n.endsWith('.md'))).toEqual(['1.md', '2.md']);
    expect(text('2.md')).not.toContain('tags:');
  });

  it('records a post it cannot render as failed right away, not after the timeout', async () => {
    const a = post('1', 'first');
    await startBatch([a.metadata.sourceUrl], 'selection');
    const broken = { ...a, metadata: { ...a.metadata, author: undefined } } as unknown as Document;
    await workerReports(broken);

    const job = session['xclipper_batch_job'] as { status: string; failures: { error: string }[] };
    expect(job.status).toBe('done');
    expect(job.failures).toHaveLength(1);
  });
});
