import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { ArticleNode, ThreadNode } from '../src/ast/types';
import { flattenTweetDetail, tweetDetailToDocument } from '../src/graphql/tweet-detail';
import { renderMarkdown } from '../src/ast/render-markdown';

// A tweet_results.result; a TweetDetail wrapping a focal item + reply modules.
const mk = (id: string, handle: string, text: string) => ({
  rest_id: id,
  core: { user_results: { result: { core: { name: handle, screen_name: handle } } } },
  legacy: { id_str: id, created_at: 'Wed Oct 10 20:19:24 +0000 2018', full_text: text, entities: {} },
});

function tweetDetail(results: ReturnType<typeof mk>[]) {
  const entries = [
    {
      entryId: `tweet-${results[0].rest_id}`,
      content: { entryType: 'TimelineTimelineItem', itemContent: { tweet_results: { result: results[0] } } },
    },
    ...results.slice(1).map((r) => ({
      entryId: `conversationthread-${r.rest_id}`,
      content: {
        entryType: 'TimelineTimelineModule',
        items: [{ item: { itemContent: { tweet_results: { result: r } } } }],
      },
    })),
  ];
  return {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [{ type: 'TimelineClearCache' }, { type: 'TimelineAddEntries', entries }],
      },
    },
  };
}

const ids = (tweets: { tweetId: string }[]) => tweets.map((t) => t.tweetId);

describe('flattenTweetDetail', () => {
  it('returns focal + module tweets in display order', () => {
    const flat = flattenTweetDetail(tweetDetail([mk('1', 'a', 'x'), mk('2', 'a', 'y'), mk('3', 'b', 'z')]));
    expect(flat.map((r) => (r as { rest_id: string }).rest_id)).toEqual(['1', '2', '3']);
  });
});

describe('tweetDetailToDocument', () => {
  it('builds a ThreadNode from the author run, stopping at the reply boundary', () => {
    const doc = tweetDetailToDocument(tweetDetail([mk('1', 'alice', 'first'), mk('2', 'alice', 'second'), mk('3', 'bob', 'a reply')]));
    expect(doc.metadata.type).toBe('thread');
    expect(doc.metadata.tweetId).toBe('1');
    const body = doc.body as ThreadNode;
    expect(body.type).toBe('thread');
    expect(ids(body.tweets)).toEqual(['1', '2']); // bob's reply excluded
  });

  it('falls back to a single tweet when the author posted no continuation', () => {
    const doc = tweetDetailToDocument(tweetDetail([mk('1', 'alice', 'lone'), mk('2', 'bob', 'reply')]));
    expect(doc.metadata.type).toBe('tweet');
    expect(doc.metadata.tweetId).toBe('1');
  });
});

// Real captured TweetDetail (git-ignored under _local/, absent in CI → skips).
const threadPath = ['_local/threaddetail-response.json', '_local/thread-response.json'].find((p) => existsSync(p));

describe.skipIf(!threadPath)('tweetDetailToDocument — real captured thread', () => {
  // Guarded: skipIf still runs this body, so don't read a missing file in CI.
  const doc = threadPath ? tweetDetailToDocument(JSON.parse(readFileSync(threadPath, 'utf8'))) : null;

  it('expands the captured self-thread into a multi-tweet ThreadNode', () => {
    if (!doc) return;
    expect(doc.metadata.type).toBe('thread');
    const body = doc.body as ThreadNode;
    expect(body.tweets.length).toBeGreaterThanOrEqual(2);
    // Every thread tweet is by the same author (the reply boundary held).
    const author = body.tweets[0].author.handle.toLowerCase();
    expect(body.tweets.every((t) => t.author.handle.toLowerCase() === author)).toBe(true);
    expect(() => renderMarkdown(doc)).not.toThrow();
  });
});

// Real captured TweetDetail whose focal item is an X Article (full Draft.js
// content_state body). Git-ignored under _local/, absent in CI → skips.
const articlePath = ['_local/article.json'].find((p) => existsSync(p));

describe.skipIf(!articlePath)('tweetDetailToDocument — real captured article', () => {
  // Guarded: skipIf still runs this body, so don't read a missing file in CI.
  const doc = articlePath ? tweetDetailToDocument(JSON.parse(readFileSync(articlePath, 'utf8'))) : null;
  const body = doc?.body as ArticleNode | undefined;

  it('maps the article body from Draft.js content_state', () => {
    if (!doc || !body) return;
    expect(doc.metadata.type).toBe('article');
    expect(doc.metadata.title.length).toBeGreaterThan(0);
    expect(body.type).toBe('article');
    expect(body.banner?.url).toMatch(/^https:\/\//);
    // The full body, not the 2-block preview stub.
    expect(body.children.length).toBeGreaterThan(10);
    const kinds = new Set(body.children.map((c) => c.type));
    expect(kinds.has('heading')).toBe(true);
    expect(kinds.has('image')).toBe(true);
    expect(kinds.has('list')).toBe(true);
  });

  it('resolves atomic blocks to real image URLs and renders', () => {
    if (!doc || !body) return;
    for (const c of body.children) {
      if (c.type === 'image') expect(c.url).toMatch(/^https:\/\/pbs\.twimg\.com\//);
    }
    expect(() => renderMarkdown(doc)).not.toThrow();
  });
});
