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
  return { ...actual, loadSettings: vi.fn(async () => ({ ...actual.DEFAULT_SETTINGS })) };
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

const { authedFetchJson, templates } = await import('../src/background/x-session');
const { writeFiles } = await import('../src/background/batch-sink');
const { loadSettings } = await import('../src/shared/settings');
const { graphqlBatchRoutes, runGraphqlBatchExport } = await import('../src/background/graphql-batch');

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
  vi.mocked(loadSettings).mockReset();
  vi.mocked(loadSettings).mockImplementation(async () => ({ ...DEFAULT_SETTINGS }));
  delete templates.UserOriginalsTimeline;
  delete templates.UserRepostsTimeline;
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

function profilePage(results: unknown[]) {
  const entries = results.map((result) => {
    const id = (result as { rest_id?: string }).rest_id ?? '0';
    return {
      entryId: `tweet-${id}`,
      content: {
        entryType: 'TimelineTimelineItem',
        itemContent: { itemType: 'TimelineTweet', tweet_results: { result } },
      },
    };
  });
  return {
    data: { user: { result: { timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries }] } } } } },
  };
}

function profileTweet(id: string, handle: string, text: string, createdAt: string) {
  return {
    rest_id: id,
    core: { user_results: { result: { legacy: { name: handle, screen_name: handle } } } },
    legacy: { id_str: id, created_at: createdAt, full_text: text, entities: {} },
  };
}

describe('runGraphqlBatchExport — profile reposts', () => {
  const postsUrl = 'https://x.com/i/api/graphql/q/UserOriginalsTimeline?variables=%7B%7D';
  const repostsUrl = 'https://x.com/i/api/graphql/q/UserRepostsTimeline?variables=%7B%7D';
  const own = profileTweet('own1', 'elonmusk', 'my post', 'Wed Oct 10 20:19:24 +0000 2018');
  const original = profileTweet('orig1', 'alex', 'the original words', 'Wed Jan 01 00:00:00 +0000 2010');
  const repost = {
    rest_id: 'wrap1',
    core: { user_results: { result: { legacy: { name: 'Elon', screen_name: 'elonmusk' } } } },
    legacy: {
      id_str: 'wrap1',
      full_text: 'RT @alex: the original words',
      created_at: 'Wed Nov 10 20:19:24 +0000 2020',
      retweeted_status_result: { result: original },
    },
  };

  beforeEach(() => {
    templates.UserOriginalsTimeline = postsUrl;
    templates.UserRepostsTimeline = repostsUrl;
    vi.mocked(authedFetchJson).mockClear();
    vi.mocked(writeFiles).mockResolvedValue(undefined);
    vi.mocked(authedFetchJson).mockImplementation(async (url: string) => {
      if (url.includes('UserOriginalsTimeline')) return profilePage([own]);
      if (url.includes('UserRepostsTimeline')) return profilePage([repost]);
      throw new Error('not found');
    });
  });

  async function exportProfile(includeReposts: boolean, maxItems = 20) {
    vi.mocked(loadSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, includeReposts });
    return runGraphqlBatchExport({
      source: 'profile',
      handle: 'elonmusk',
      expandThreads: false,
      maxItems,
    });
  }

  function written(): string {
    return JSON.stringify(vi.mocked(writeFiles).mock.calls);
  }

  it('saves the original post when Include reposts is on, and prefers the newer repost', async () => {
    const result = await exportProfile(true, 1);
    expect(result?.exported).toBe(1);
    expect(written()).toContain('the original words');
    expect(written()).not.toContain('RT @');
    expect(written()).not.toContain('my post');
    expect(vi.mocked(authedFetchJson).mock.calls.some(([url]) => String(url).includes('UserRepostsTimeline'))).toBe(true);
  });

  it('does not read the Reposts tab when Include reposts is off', async () => {
    const result = await exportProfile(false, 20);
    expect(result?.exported).toBe(1);
    expect(written()).toContain('my post');
    expect(written()).not.toContain('the original words');
    expect(vi.mocked(authedFetchJson).mock.calls.some(([url]) => String(url).includes('UserRepostsTimeline'))).toBe(false);
  });

  it('stops and names the Reposts tab when that request was not captured', async () => {
    delete templates.UserRepostsTimeline;
    const result = await exportProfile(true, 20);
    expect(result).toBeNull();
    const status = (await graphqlBatchRoutes.FAST_BATCH_STATUS!.handle(
      { action: 'FAST_BATCH_STATUS' },
      {} as chrome.runtime.MessageSender,
    )) as { progress: { error?: string } };
    expect(status.progress.error).toContain('x.com/elonmusk/reposts');
    expect(vi.mocked(authedFetchJson)).not.toHaveBeenCalled();
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
