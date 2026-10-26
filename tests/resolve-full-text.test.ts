import { describe, it, expect, beforeEach, vi } from 'vitest';
import { receiveFullText, resolveFullText } from '../src/background/resolve-full-text';

// Without the webRequest grant, each cut-off post is read from its own page in
// one window. The content script there answers with FULL_TEXT_RESULT; here the
// window mocks answer for it.
const chromeMock = (globalThis as unknown as { chrome: Record<string, unknown> }).chrome;
let answers: Record<string, string | undefined>;
const tabsUpdate = vi.fn();
const windowsRemove = vi.fn();

function answerFor(url: string): void {
  const id = url.match(/status\/(\d+)/)![1];
  const value = answers[id];
  setTimeout(() =>
    receiveFullText({
      action: 'FULL_TEXT_RESULT',
      tweetId: id,
      ...(value ? { text: [{ type: 'text', value }] } : {}),
    })
  );
}

beforeEach(() => {
  tabsUpdate.mockReset().mockImplementation(async (_tabId: number, { url }: { url: string }) => answerFor(url));
  windowsRemove.mockReset().mockResolvedValue(undefined);
  chromeMock.permissions = { contains: async () => false };
  chromeMock.storage = { ...(chromeMock.storage as object), session: { get: async () => ({}), set: async () => {} } };
  chromeMock.tabs = { ...(chromeMock.tabs as object), update: tabsUpdate };
  chromeMock.windows = {
    create: async ({ url }: { url: string }) => {
      answerFor(url);
      return { id: 5, tabs: [{ id: 7 }] };
    },
    remove: windowsRemove,
  };
});

const posts = [
  { tweetId: '1', handle: 'a' },
  { tweetId: '2', handle: 'a' },
];

describe('resolveFullText from post pages', () => {
  it('reads every post in one window, then closes it', async () => {
    answers = { '1': 'one in full', '2': 'two in full' };
    const { texts } = await resolveFullText({ action: 'RESOLVE_FULL_TEXT', tweetId: '9', posts });
    expect(texts.map(([id]) => id)).toEqual(['1', '2']);
    expect(tabsUpdate).toHaveBeenCalledTimes(1);
    expect(windowsRemove).toHaveBeenCalledWith(5);
  });

  it('stops at the first page that gives no text', async () => {
    answers = { '1': undefined, '2': 'two in full' };
    const { texts } = await resolveFullText({ action: 'RESOLVE_FULL_TEXT', tweetId: '9', posts });
    expect(texts).toEqual([]);
    expect(tabsUpdate).not.toHaveBeenCalled();
    expect(windowsRemove).toHaveBeenCalledWith(5);
  });
});
