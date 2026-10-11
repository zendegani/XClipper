import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { ArticleNode, ThreadNode } from '../src/ast/types';
import { collectMedia, isDownloadableVideo } from '../src/ast/collect-media';
import {
  flattenTweetDetail,
  tweetDetailEmbeddedTweetIds,
  tweetDetailFocalTweetNode,
  tweetDetailToDocument,
} from '../src/graphql/tweet-detail';
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
    const doc = tweetDetailToDocument(tweetDetail([mk('1', 'alice', 'first'), mk('2', 'alice', 'second'), mk('3', 'bob', 'a reply')]), '1');
    expect(doc.metadata.type).toBe('thread');
    expect(doc.metadata.tweetId).toBe('1');
    const body = doc.body as ThreadNode;
    expect(body.type).toBe('thread');
    expect(ids(body.tweets)).toEqual(['1', '2']); // bob's reply excluded
  });

  it('falls back to a single tweet when the author posted no continuation', () => {
    const doc = tweetDetailToDocument(tweetDetail([mk('1', 'alice', 'lone'), mk('2', 'bob', 'reply')]), '1');
    expect(doc.metadata.type).toBe('tweet');
    expect(doc.metadata.tweetId).toBe('1');
  });

  // For a reply, X lists the posts it replies to before it (issue #150).
  it('exports the requested reply, not the post it replies to', () => {
    const raw = tweetDetail([mk('1', 'alice', 'parent'), mk('2', 'bob', 'the reply'), mk('3', 'carol', 'a reply to bob')]);
    const doc = tweetDetailToDocument(raw, '2');
    expect(doc.metadata.type).toBe('tweet');
    expect(doc.metadata.tweetId).toBe('2');
    expect(doc.metadata.author.handle).toBe('bob');
    expect(renderMarkdown(doc)).toContain('the reply');
  });

  // The body starts at the thread's first post, but the id stays the requested
  // post's, so the file name matches `source:` and Manual's export (#157).
  it('roots a mid-thread request at the thread start, keeping the requested id', () => {
    const raw = tweetDetail([mk('1', 'alice', 'first'), mk('2', 'alice', 'second'), mk('3', 'alice', 'third')]);
    const doc = tweetDetailToDocument(raw, '2');
    expect(doc.metadata.type).toBe('thread');
    expect(doc.metadata.tweetId).toBe('2');
    expect(doc.metadata.sourceUrl).toBe('https://x.com/alice/status/2');
    expect(ids((doc.body as ThreadNode).tweets)).toEqual(['1', '2', '3']);
  });

  it('stops walking back at another author, even when the thread author posted earlier', () => {
    const raw = tweetDetail([mk('1', 'alice', 'old post'), mk('2', 'bob', 'reply'), mk('3', 'alice', 'new post')]);
    const doc = tweetDetailToDocument(raw, '3');
    expect(doc.metadata.type).toBe('tweet');
    expect(doc.metadata.tweetId).toBe('3');
  });

  it('keeps a reply\'s own video, for local download', () => {
    const video = {
      type: 'video',
      media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/5/pu/img/poster.jpg',
      video_info: { variants: [{ content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/ext_tw_video/5/pu/vid/640x360/a.mp4' }] },
    };
    const reply = { ...mk('2', 'bob', 'watch this'), legacy: { ...mk('2', 'bob', 'watch this').legacy, extended_entities: { media: [video] } } };
    const doc = tweetDetailToDocument(tweetDetail([mk('1', 'alice', 'parent'), reply]), '2');
    expect(collectMedia(doc).filter(isDownloadableVideo).map((m) => m.url)).toEqual([
      'https://video.twimg.com/ext_tw_video/5/pu/vid/640x360/a.mp4',
    ]);
  });

  // The posts above the thread are what the reply answers (issue #154).
  it('carries the posts a reply answers as context, oldest first', () => {
    const raw = tweetDetail([mk('1', 'alice', 'root'), mk('2', 'carol', 'parent'), mk('3', 'bob', 'the reply'), mk('4', 'dave', 'a reply to bob')]);
    const doc = tweetDetailToDocument(raw, '3');
    expect(ids(doc.context ?? [])).toEqual(['1', '2']);
    expect(doc.metadata.author.handle).toBe('bob');
    expect(doc.metadata.tweetId).toBe('3');
  });

  it('carries the posts above a self-thread as its context', () => {
    const raw = tweetDetail([mk('1', 'bob', 'question'), mk('2', 'alice', 'first'), mk('3', 'alice', 'second'), mk('4', 'alice', 'third')]);
    const doc = tweetDetailToDocument(raw, '3');
    expect(ids(doc.context ?? [])).toEqual(['1']);
    expect(ids((doc.body as ThreadNode).tweets)).toEqual(['2', '3', '4']);
  });

  it('keeps the author\'s own older post as context when someone else sits between', () => {
    const raw = tweetDetail([mk('1', 'alice', 'old post'), mk('2', 'bob', 'reply'), mk('3', 'alice', 'new post')]);
    expect(ids(tweetDetailToDocument(raw, '3').context ?? [])).toEqual(['1', '2']);
  });

  it('adds no context to a post that answers nothing', () => {
    const doc = tweetDetailToDocument(tweetDetail([mk('1', 'alice', 'lone'), mk('2', 'bob', 'reply')]), '1');
    expect('context' in doc).toBe(false);
  });

  it('throws when the response does not carry the requested post', () => {
    expect(() => tweetDetailToDocument(tweetDetail([mk('1', 'alice', 'other')]), '9')).toThrow(/9/);
  });
});

// A post embedded in an Article body is named by id only — the article payload
// carries none of its content — so the caller fetches each id and hands the
// mapped tweets back through `embeds` (issue #123).
describe('embedded posts in an Article body', () => {
  const articleWithEmbed = (tweetId: string) => ({
    ...mk('1', 'alice', 'https://t.co/abc'),
    article: {
      article_results: {
        result: {
          rest_id: '999',
          title: 'My Long Read',
          content_state: {
            blocks: [{ type: 'atomic', text: ' ', entityRanges: [{ key: 0, offset: 0, length: 1 }] }],
            entityMap: [{ key: '0', value: { type: 'TWEET', data: { tweetId } } }],
          },
        },
      },
    },
  });

  it('reports the ids the article body embeds', () => {
    expect(tweetDetailEmbeddedTweetIds(tweetDetail([articleWithEmbed('777')]), '1')).toEqual(['777']);
    expect(tweetDetailEmbeddedTweetIds(tweetDetail([mk('1', 'alice', 'plain')]), '1')).toEqual([]);
  });

  it('reads the embeds of a requested article that is itself a reply', () => {
    const raw = tweetDetail([mk('5', 'bob', 'parent'), articleWithEmbed('777')]);
    expect(tweetDetailEmbeddedTweetIds(raw, '1')).toEqual(['777']);
  });

  it('maps an embedded post that is a reply to that post, not its parent', () => {
    const raw = tweetDetail([mk('5', 'bob', 'parent'), mk('777', 'carol', 'the embedded reply')]);
    const embedded = tweetDetailFocalTweetNode(raw, '777');
    expect(embedded.tweetId).toBe('777');
    expect(embedded.author.handle).toBe('carol');
  });

  // Minimized from a real public TweetDetail capture for status
  // 2076690611399176506 — three body blocks around the embed, plus the TWEET
  // entity verbatim. It pins the field path (`data.tweetId`), which is the one
  // thing the hand-modeled fixtures above can't vouch for.
  it('reads the TWEET entity out of a real captured article body', () => {
    const raw = JSON.parse(
      readFileSync('tests/fixtures/graphql/tweetdetail-2076690611399176506-embedded-tweet.min.json', 'utf8')
    );
    expect(tweetDetailEmbeddedTweetIds(raw, '2076690611399176506')).toEqual(['2071293386724982947']);

    // Un-fetched, the embed sits between the two paragraphs it separates —
    // where it used to leave a hole.
    const md = renderMarkdown(tweetDetailToDocument(raw, '2076690611399176506'));
    expect(md).toContain(
      'Example on how you can sell your product with this mechanics:\n\n> [Embedded post on X](https://x.com/i/status/2071293386724982947)\n\nHis tweet got 765'
    );
  });

  it('maps an embedded post fetch to the TweetNode the article body needs', () => {
    const embedded = tweetDetailFocalTweetNode(tweetDetail([mk('777', 'bob', 'the embedded post')]), '777');
    expect(embedded.tweetId).toBe('777');

    const doc = tweetDetailToDocument(
      tweetDetail([articleWithEmbed('777')]),
      '1',
      undefined,
      new Map([['777', embedded]])
    );
    expect((doc.body as ArticleNode).children).toEqual([embedded]);
  });
});

// Minimized from a real public TweetDetail capture for status 2059312764448051555.
// It preserves X's article MEDIA entity, ApiVideo media_info, and variant field
// names while dropping replies and unrelated article blocks.
describe('tweetDetailToDocument — captured article video', () => {
  const raw = JSON.parse(
    readFileSync('tests/fixtures/graphql/tweetdetail-2059312764448051555-video.min.json', 'utf8')
  );
  const doc = tweetDetailToDocument(raw, '2059312764448051555');
  const body = doc.body as ArticleNode;
  // The 720p rung, not the 1080p one the fixture also carries — see the cap in
  // bestVariant.
  const mp4 = 'https://video.twimg.com/amplify_video/2059311116694757376/vid/avc1/1280x720/xpclcol5eLxJgMu9.mp4?tag=27';
  const poster = 'https://pbs.twimg.com/amplify_video_thumb/2059311116694757376/img/P-7i_6SwXeHF5lkV.jpg';

  it('maps the capped progressive MP4 into a downloadable VideoNode', () => {
    expect(doc.metadata.type).toBe('article');
    expect(body.children.filter((block) => block.type === 'video')).toEqual([
      { type: 'video', posterUrl: poster, sourceUrl: mp4 },
    ]);
    expect(collectMedia(doc).filter(isDownloadableVideo).map((media) => media.url)).toEqual([mp4]);
    expect(renderMarkdown(doc)).not.toContain(`[▶ Video](${mp4})`);
    expect(renderMarkdown(doc, { includeVideoLinks: true })).toContain(`[▶ Video](${mp4})`);
  });
});

// Real captured TweetDetail (git-ignored under tests/_local/, absent in CI → skips).
// The id is the capture's focal post, which the mapper now needs by name.
const threadPath = ['tests/_local/threaddetail-response.json'].find((p) => existsSync(p));

describe.skipIf(!threadPath)('tweetDetailToDocument — real captured thread', () => {
  // Guarded: skipIf still runs this body, so don't read a missing file in CI.
  const doc = threadPath ? tweetDetailToDocument(JSON.parse(readFileSync(threadPath, 'utf8')), '2059282561545666610') : null;

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
// content_state body). Git-ignored under tests/_local/, absent in CI → skips.
const articlePath = ['tests/_local/article.json'].find((p) => existsSync(p));

describe.skipIf(!articlePath)('tweetDetailToDocument — real captured article', () => {
  // Guarded: skipIf still runs this body, so don't read a missing file in CI.
  const doc = articlePath ? tweetDetailToDocument(JSON.parse(readFileSync(articlePath, 'utf8')), '2061907337154367865') : null;
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
