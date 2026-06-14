import { describe, it, expect } from 'vitest';
import {
  getVariables,
  paginateTimeline,
  parseTimelinePage,
  setVariablesParam,
  withCursor,
} from '../src/graphql/timeline';

// Synthetic timeline pages mirroring the real Bookmarks shape (validated in
// json-to-ast-live.test.ts). These always run, including in CI.
function page(tweetIds: string[], bottomCursor: string | null) {
  const entries: unknown[] = tweetIds.map((id) => ({
    entryId: `tweet-${id}`,
    content: {
      entryType: 'TimelineTimelineItem',
      itemContent: { itemType: 'TimelineTweet', tweet_results: { result: { rest_id: id } } },
    },
  }));
  entries.push({
    entryId: 'cursor-top-x',
    content: { entryType: 'TimelineTimelineCursor', cursorType: 'Top', value: 'TOP' },
  });
  if (bottomCursor) {
    entries.push({
      entryId: `cursor-bottom-${bottomCursor}`,
      content: { entryType: 'TimelineTimelineCursor', cursorType: 'Bottom', value: bottomCursor },
    });
  }
  return { data: { bookmark_timeline_v2: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries }] } } } };
}

const ids = (tweets: unknown[]) => tweets.map((t) => (t as { rest_id: string }).rest_id);

describe('parseTimelinePage', () => {
  it('pulls tweet results and the bottom cursor in feed order', () => {
    const p = parseTimelinePage(page(['1', '2'], 'CUR1'));
    expect(ids(p.tweetResults)).toEqual(['1', '2']);
    expect(p.bottomCursor).toBe('CUR1');
    expect(p.done).toBe(false);
  });

  it('flags the end of the feed when a page carries no tweets', () => {
    const p = parseTimelinePage(page([], 'CUR_END'));
    expect(p.tweetResults).toEqual([]);
    expect(p.done).toBe(true);
  });

  it('returns an empty page for an unrecognized payload', () => {
    const p = parseTimelinePage({ data: {} });
    expect(p.tweetResults).toEqual([]);
    expect(p.bottomCursor).toBeNull();
    expect(p.done).toBe(true);
  });

  it('finds a profile/likes user timeline and pulls module (self-thread) tweets', () => {
    const raw = {
      data: {
        user: {
          result: {
            timeline_v2: {
              timeline: {
                instructions: [
                  {
                    type: 'TimelineAddEntries',
                    entries: [
                      { entryId: 'tweet-1', content: { itemContent: { tweet_results: { result: { rest_id: '1' } } } } },
                      {
                        entryId: 'profile-conversation-9',
                        content: {
                          entryType: 'TimelineTimelineModule',
                          items: [
                            { item: { itemContent: { tweet_results: { result: { rest_id: '2' } } } } },
                            { item: { itemContent: { tweet_results: { result: { rest_id: '3' } } } } },
                          ],
                        },
                      },
                      { entryId: 'cursor-bottom-x', content: { cursorType: 'Bottom', value: 'CUR' } },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    };
    const p = parseTimelinePage(raw);
    expect(ids(p.tweetResults)).toEqual(['1', '2', '3']);
    expect(p.bottomCursor).toBe('CUR');
  });

  it('falls back to a generic search when the data key is unknown', () => {
    const raw = {
      data: {
        some_new_timeline: {
          timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [
            { entryId: 'tweet-7', content: { itemContent: { tweet_results: { result: { rest_id: '7' } } } } },
          ] }] },
        },
      },
    };
    expect(ids(parseTimelinePage(raw).tweetResults)).toEqual(['7']);
  });
});

describe('request URL helpers', () => {
  const base = 'https://x.com/i/api/graphql/QID/Bookmarks';

  it('reads and replaces the variables param', () => {
    const url = setVariablesParam(`${base}?features=%7B%7D`, JSON.stringify({ count: 20 }));
    expect(JSON.parse(getVariables(url))).toEqual({ count: 20 });
    expect(url).toContain('features=%7B%7D'); // other params preserved
  });

  it('injects a cursor while preserving other variables', () => {
    expect(JSON.parse(withCursor(JSON.stringify({ count: 20, cursor: null }), 'NEXT'))).toEqual({
      count: 20,
      cursor: 'NEXT',
    });
  });
});

describe('paginateTimeline', () => {
  const base = 'https://x.com/i/api/graphql/QID/Bookmarks?features=%7B%7D';

  it('walks pages by cursor and stops at the end of the feed', async () => {
    const pages: Record<string, ReturnType<typeof page>> = {
      first: page(['1', '2'], 'C1'),
      C1: page(['3'], 'C2'),
      C2: page([], null), // end
    };
    const calls: string[] = [];
    const fetchJson = async (url: string) => {
      calls.push(url);
      return pages[(JSON.parse(getVariables(url)).cursor as string) ?? 'first'];
    };

    const initial = setVariablesParam(base, JSON.stringify({ count: 20 }));
    const got: string[] = [];
    for await (const tweets of paginateTimeline(initial, fetchJson)) got.push(...ids(tweets));

    expect(got).toEqual(['1', '2', '3']);
    expect(calls).toHaveLength(3); // first + C1 + C2(end)
  });

  it('honors the maxPages safety cap on an endless feed', async () => {
    let n = 0;
    const fetchJson = async () => page([String(++n)], `C${n}`); // never ends
    const initial = setVariablesParam('https://x.com/i/api/graphql/QID/Bookmarks', JSON.stringify({ count: 20 }));

    const got: string[] = [];
    for await (const tweets of paginateTimeline(initial, fetchJson, { maxPages: 3 })) got.push(...ids(tweets));

    expect(got).toEqual(['1', '2', '3']);
  });
});
