import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { EXPORTED_LEDGER_KEY } from '../src/shared/export-ledger';

// The run loop with X's session, settings, and the download sink mocked out:
// enough to drive a bookmarks run end to end and hold one download open the
// way a multi-minute video does in Chrome.

vi.mock('../src/background/x-session', () => ({
  templates: {
    Bookmarks: 'https://x.com/i/api/graphql/q/Bookmarks?variables=%7B%7D',
    TweetDetail: 'https://x.com/i/api/graphql/q/TweetDetail?variables=%7B%7D',
  },
  authedFetchJson: vi.fn(),
  classify: () => 'permanent',
  GraphqlError: class extends Error {},
  hasAccess: async () => true,
  requestGraphqlAccess: async () => true,
  restoreSession: async () => {},
  startCapturing: () => {},
}));

vi.mock('../src/shared/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/shared/settings')>();
  return { ...actual, loadSettings: async () => ({ ...actual.DEFAULT_SETTINGS }) };
});

vi.mock('../src/shared/review-prompt', () => ({ recordExport: async () => {} }));

vi.mock('../src/background/batch-sink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/background/batch-sink')>();
  return {
    ...actual,
    writeFiles: vi.fn(),
    writeJsonManifest: vi.fn(async () => {}),
    writeCombined: vi.fn(async () => {}),
    downloadZipArchive: vi.fn(async () => {}),
  };
});

const { authedFetchJson } = await import('../src/background/x-session');
const { writeFiles } = await import('../src/background/batch-sink');
const { runGraphqlBatchExport } = await import('../src/background/graphql-batch');

function tweet(id: string) {
  return {
    rest_id: id,
    core: { user_results: { result: { legacy: { name: 'Bob', screen_name: 'bob' } } } },
    legacy: { id_str: id, created_at: 'Wed Oct 10 20:19:24 +0000 2018', full_text: `post ${id}`, entities: {} },
  };
}

function bookmarksPage(ids: string[]) {
  const entries = ids.map((id) => ({
    entryId: `tweet-${id}`,
    content: {
      entryType: 'TimelineTimelineItem',
      itemContent: { itemType: 'TimelineTweet', tweet_results: { result: tweet(id) } },
    },
  }));
  return { data: { bookmark_timeline_v2: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries }] } } } };
}

let store: Record<string, unknown>;
let getPlatformInfo: ReturnType<typeof vi.fn>;

// Writes resolve except the `hangAt`-th (1-based), which never finishes, the
// way a long video download looks to the run. Resolves `started` when it begins.
function hangWrite(hangAt: number): { started: Promise<void>; release: () => void } {
  let release = (): void => {};
  let signal = (): void => {};
  const started = new Promise<void>((r) => (signal = r));
  let calls = 0;
  vi.mocked(writeFiles).mockImplementation(() => {
    if (++calls !== hangAt) return Promise.resolve();
    signal();
    return new Promise<void>((r) => (release = r));
  });
  return { started, release: () => release() };
}

beforeEach(() => {
  store = {};
  getPlatformInfo = vi.fn(async () => ({}));
  const chromeGlobal = (globalThis as unknown as { chrome: Record<string, Record<string, unknown>> }).chrome;
  chromeGlobal.runtime.getPlatformInfo = getPlatformInfo;
  chromeGlobal.storage.local = {
    get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
    set: async (items: Record<string, unknown>) => void Object.assign(store, items),
  };
  vi.mocked(authedFetchJson).mockImplementation(async (url: string) => {
    if (url.includes('/Bookmarks')) return bookmarksPage(['1', '2', '3']);
    throw new Error('not found'); // TweetDetail: the root tweet stays the final answer
  });
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(writeFiles).mockReset();
});

describe('runGraphqlBatchExport — long downloads', () => {
  it('keeps calling an extension API while a download runs, and stops when the run ends', async () => {
    const write = hangWrite(1);
    const run = runGraphqlBatchExport();
    await write.started;

    await vi.advanceTimersByTimeAsync(65_000);
    expect(getPlatformInfo.mock.calls.length).toBeGreaterThanOrEqual(3);

    write.release();
    await run;
    getPlatformInfo.mockClear();
    await vi.advanceTimersByTimeAsync(65_000);
    expect(getPlatformInfo).not.toHaveBeenCalled();
  });
});

describe('runGraphqlBatchExport — a run cut off mid-write', () => {
  // The run never finishes (Chrome kills the worker), so only what was saved
  // while it ran survives. Posts whose files landed must be in the ledger; the
  // one still downloading must not be, so the next run redoes it.
  it.each([
    ['Auto Full (threads expanded, written at the end)', true],
    ['Auto Fast (streamed while the feed is read)', false],
  ])('%s saves the posts already on disk', async (_name, expandThreads) => {
    const write = hangWrite(3);
    void runGraphqlBatchExport({ expandThreads });
    await write.started;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(store[EXPORTED_LEDGER_KEY]).toEqual(['1', '2']);
  });
});
