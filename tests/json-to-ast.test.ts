import { describe, it, expect } from 'vitest';
import { jsonToAst, jsonToTweetNode } from '../src/graphql/json-to-ast';
import { renderMarkdown } from '../src/ast/render-markdown';

// Fixtures here are MODELED ON X's documented GraphQL schema, not captured from
// a live response (that needs a logged-in session — see ADR 0003). They pin the
// mapper's behavior; field paths must be re-validated against a real capture
// before the fetch layer is trusted.

const user = {
  is_blue_verified: true,
  legacy: {
    name: 'Bob Example',
    screen_name: 'bob',
    profile_image_url_https: 'https://pbs.twimg.com/bob.jpg',
  },
};

// Build a tweet_results.result. `legacy` merges into the legacy object;
// `extra` merges at the tweet top level (note_tweet, card, quoted_status…).
function tweet(legacy: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    rest_id: '123',
    core: { user_results: { result: user } },
    legacy: {
      id_str: '123',
      created_at: 'Wed Oct 10 20:19:24 +0000 2018',
      full_text: 'hello world',
      favorite_count: 5,
      retweet_count: 2,
      reply_count: 1,
      bookmark_count: 3,
      entities: {},
      ...legacy,
    },
    views: { count: '1000' },
    ...extra,
  };
}

describe('jsonToAst — metadata', () => {
  it('maps author, date, id, engagement, and derives sourceUrl', () => {
    const doc = jsonToAst(tweet());
    expect(doc.metadata.type).toBe('tweet');
    expect(doc.metadata.tweetId).toBe('123');
    expect(doc.metadata.author).toEqual({
      name: 'Bob Example',
      handle: 'bob',
      avatarUrl: 'https://pbs.twimg.com/bob.jpg',
      verified: true,
    });
    expect(doc.metadata.date).toBe(new Date('Wed Oct 10 20:19:24 +0000 2018').toISOString());
    expect(doc.metadata.engagement).toEqual({
      replies: 1,
      reposts: 2,
      likes: 5,
      bookmarks: 3,
      views: 1000,
    });
    expect(doc.metadata.sourceUrl).toBe('https://x.com/bob/status/123');
  });

  it('honors an explicit sourceUrl', () => {
    const doc = jsonToAst(tweet(), 'https://x.com/bob/status/123/photo/1');
    expect(doc.metadata.sourceUrl).toBe('https://x.com/bob/status/123/photo/1');
  });
});

describe('jsonToTweetNode — inline text from entities', () => {
  it('splices mentions, hashtags, cashtags, and url links by codepoint indices', () => {
    const node = jsonToTweetNode(
      tweet({
        full_text: 'hi @bob #ai $TSLA https://t.co/x',
        entities: {
          user_mentions: [{ screen_name: 'bob', indices: [3, 7] }],
          hashtags: [{ text: 'ai', indices: [8, 11] }],
          symbols: [{ text: 'TSLA', indices: [12, 17] }],
          urls: [
            {
              url: 'https://t.co/x',
              expanded_url: 'https://example.com',
              display_url: 'example.com',
              indices: [18, 32],
            },
          ],
        },
      })
    );
    expect(node.text).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'entity', kind: 'mention', value: 'bob', url: 'https://x.com/bob' },
      { type: 'text', value: ' ' },
      { type: 'entity', kind: 'hashtag', value: 'ai', url: 'https://x.com/hashtag/ai' },
      { type: 'text', value: ' ' },
      { type: 'entity', kind: 'cashtag', value: 'TSLA', url: 'https://x.com/search?q=%24TSLA' },
      { type: 'text', value: ' ' },
      { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: 'example.com' }] },
    ]);
  });

  it('drops the trailing media t.co link and decodes HTML entities', () => {
    const node = jsonToTweetNode(
      tweet({
        full_text: 'me &amp; you https://t.co/m',
        entities: { media: [{ url: 'https://t.co/m', indices: [13, 27] }] },
      })
    );
    expect(node.text).toEqual([{ type: 'text', value: 'me & you' }]);
  });

  it('splits newlines into break nodes', () => {
    const node = jsonToTweetNode(tweet({ full_text: 'line one\nline two' }));
    expect(node.text).toEqual([
      { type: 'text', value: 'line one' },
      { type: 'break' },
      { type: 'text', value: 'line two' },
    ]);
  });

  it('prefers note_tweet long-form text over truncated full_text', () => {
    const node = jsonToTweetNode(
      tweet(
        { full_text: 'short truncated…' },
        { note_tweet: { note_tweet_results: { result: { text: 'the full long text' } } } }
      )
    );
    expect(node.text).toEqual([{ type: 'text', value: 'the full long text' }]);
  });

  it('splices long-form text with note_tweet entity_set, NOT legacy.entities', () => {
    // Real-data bug guard: legacy.entities indices are relative to the
    // truncated full_text; using them against the full note text mis-places
    // links. The link lands correctly only if entity_set drives the splice.
    const node = jsonToTweetNode(
      tweet(
        {
          full_text: 'WRONG truncated https://t.co/trunc',
          entities: {
            urls: [{ url: 'https://t.co/trunc', expanded_url: 'https://wrong', display_url: 'wrong', indices: [0, 5] }],
          },
        },
        {
          note_tweet: {
            note_tweet_results: {
              result: {
                text: 'long body link https://t.co/x end',
                entity_set: {
                  urls: [
                    {
                      url: 'https://t.co/x',
                      expanded_url: 'https://full.example',
                      display_url: 'full.example',
                      indices: [15, 29],
                    },
                  ],
                },
              },
            },
          },
        }
      )
    );
    expect(node.text).toEqual([
      { type: 'text', value: 'long body link ' },
      { type: 'link', url: 'https://full.example', children: [{ type: 'text', value: 'full.example' }] },
      { type: 'text', value: ' end' },
    ]);
  });
});

describe('jsonToTweetNode — media', () => {
  it('maps photos and picks the highest-bitrate mp4 video variant', () => {
    const node = jsonToTweetNode(
      tweet({
        extended_entities: {
          media: [
            { type: 'photo', media_url_https: 'https://pbs.twimg.com/p.jpg', ext_alt_text: 'a cat' },
            {
              type: 'video',
              media_url_https: 'https://pbs.twimg.com/poster.jpg',
              video_info: {
                variants: [
                  { content_type: 'application/x-mpegURL', url: 'https://video/x.m3u8' },
                  { content_type: 'video/mp4', bitrate: 256000, url: 'https://video/low.mp4' },
                  { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video/high.mp4' },
                ],
              },
            },
          ],
        },
      })
    );
    expect(node.media).toEqual([
      { kind: 'image', url: 'https://pbs.twimg.com/p.jpg', alt: 'a cat' },
      { kind: 'video', url: 'https://video/high.mp4', posterUrl: 'https://pbs.twimg.com/poster.jpg' },
    ]);
  });
});

describe('jsonToTweetNode — quotes and wrappers', () => {
  it('recurses into a quoted tweet', () => {
    const quoted = tweet({ id_str: '999', full_text: 'quoted body' }, { rest_id: '999' });
    const node = jsonToTweetNode(tweet({}, { quoted_status_result: { result: quoted } }));
    expect(node.quotedTweet?.tweetId).toBe('999');
    expect(node.quotedTweet?.text).toEqual([{ type: 'text', value: 'quoted body' }]);
  });

  it('unwraps TweetWithVisibilityResults', () => {
    const node = jsonToTweetNode({
      __typename: 'TweetWithVisibilityResults',
      tweet: tweet({ full_text: 'visible' }),
    });
    expect(node.text).toEqual([{ type: 'text', value: 'visible' }]);
  });
});

describe('jsonToAst — renderer compatibility', () => {
  // The premise of Fast Batch (ADR 0003): a mapped Document feeds the existing
  // renderers unchanged. This proves the output is renderer-compatible — text,
  // entity link, and image all survive into Markdown.
  it('renders to Markdown via the existing renderMarkdown', () => {
    const doc = jsonToAst(
      tweet({
        full_text: 'see @bob https://t.co/x',
        entities: {
          user_mentions: [{ screen_name: 'bob', indices: [4, 8] }],
          urls: [
            {
              url: 'https://t.co/x',
              expanded_url: 'https://example.com',
              display_url: 'example.com',
              indices: [9, 23],
            },
          ],
        },
        extended_entities: {
          media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/p.jpg', ext_alt_text: 'cat' }],
        },
      })
    );
    const md = renderMarkdown(doc);
    expect(md).toContain('@bob');
    expect(md).toContain('https://example.com');
    expect(md).toContain('https://pbs.twimg.com/p.jpg');
    expect(md.length).toBeGreaterThan(0);
  });
});

describe('jsonToAst — X Articles', () => {
  const articleResult = {
    rest_id: '123',
    core: { user_results: { result: user } },
    legacy: {
      id_str: '123',
      created_at: 'Wed Oct 10 20:19:24 +0000 2018',
      full_text: 'https://t.co/abc',
      favorite_count: 7,
      entities: { urls: [{ expanded_url: 'http://x.com/i/article/999', indices: [0, 16] }] },
    },
    views: { count: '50' },
    article: {
      article_results: {
        result: {
          rest_id: '999',
          title: 'My Long Read',
          preview_text: 'A teaser of the article body.',
          cover_media: { media_info: { original_img_url: 'https://pbs.twimg.com/media/cover.jpg' } },
        },
      },
    },
  };

  it('detects an article, labels the type, and builds a title + cover + preview + link stub', () => {
    const doc = jsonToAst(articleResult);
    expect(doc.metadata.type).toBe('article');
    expect(doc.metadata.title).toBe('My Long Read');
    expect(doc.metadata.engagement).toEqual({ likes: 7, views: 50 });
    expect(doc.body).toEqual({
      type: 'article',
      banner: { type: 'image', url: 'https://pbs.twimg.com/media/cover.jpg' },
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'A teaser of the article body.' }] },
        {
          type: 'paragraph',
          children: [
            { type: 'link', url: 'https://x.com/i/article/999', children: [{ type: 'text', value: 'Read the full article on X' }] },
          ],
        },
      ],
    });
  });

  // When TweetDetail supplies a Draft.js content_state, map the full body
  // (paragraphs/headings/lists/images + inline bold/italic/links) instead of
  // the preview stub. entityRanges index entityMap by stringified key; atomic
  // blocks resolve their MEDIA entity to a URL via media_entities.
  it('maps the Draft.js content_state to a full article body', () => {
    const result = {
      ...articleResult,
      article: {
        article_results: {
          result: {
            ...articleResult.article.article_results.result,
            media_entities: [
              { media_id: '555', media_info: { original_img_url: 'https://pbs.twimg.com/media/pic.jpg' } },
            ],
            content_state: {
              blocks: [
                { type: 'header-one', text: 'Big Title' },
                {
                  type: 'unstyled',
                  text: 'Plain bold and a link here',
                  inlineStyleRanges: [{ offset: 6, length: 4, style: 'Bold' }],
                  entityRanges: [{ key: 0, offset: 17, length: 4 }],
                },
                { type: 'unordered-list-item', text: 'first' },
                { type: 'unordered-list-item', text: 'second' },
                { type: 'atomic', text: ' ', entityRanges: [{ key: 1, offset: 0, length: 1 }] },
                { type: 'unstyled', text: '' },
              ],
              entityMap: [
                { key: '0', value: { type: 'LINK', data: { url: 'https://example.com/x' } } },
                { key: '1', value: { type: 'MEDIA', data: { mediaItems: [{ mediaId: '555' }] } } },
              ],
            },
          },
        },
      },
    };
    const doc = jsonToAst(result);
    const body = doc.body as { type: string; banner?: unknown; children: unknown[] };
    expect(doc.metadata.type).toBe('article');
    expect(body.children).toEqual([
      { type: 'heading', depth: 1, children: [{ type: 'text', value: 'Big Title' }] },
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'Plain ' },
          { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
          { type: 'text', value: ' and a ' },
          { type: 'link', url: 'https://example.com/x', children: [{ type: 'text', value: 'link' }] },
          { type: 'text', value: ' here' },
        ],
      },
      {
        type: 'list',
        ordered: false,
        children: [
          { type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'first' }] }] },
          { type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'second' }] }] },
        ],
      },
      { type: 'image', url: 'https://pbs.twimg.com/media/pic.jpg' },
    ]);
  });
});

describe('jsonToTweetNode — cards', () => {
  it('maps a poll card to a PollNode with computed percents', () => {
    const node = jsonToTweetNode(
      tweet(
        {},
        {
          card: {
            legacy: {
              name: 'poll2choice_text_only',
              binding_values: [
                { key: 'choice1_label', value: { string_value: 'Cats' } },
                { key: 'choice1_count', value: { string_value: '30' } },
                { key: 'choice2_label', value: { string_value: 'Dogs' } },
                { key: 'choice2_count', value: { string_value: '10' } },
              ],
            },
          },
        }
      )
    );
    expect(node.poll).toEqual({
      type: 'poll',
      choices: [
        { label: 'Cats', percent: 75 },
        { label: 'Dogs', percent: 25 },
      ],
    });
  });

  it('maps a summary card to a LinkCardNode', () => {
    const node = jsonToTweetNode(
      tweet(
        {},
        {
          card: {
            legacy: {
              name: 'summary_large_image',
              binding_values: [
                { key: 'title', value: { string_value: 'A Title' } },
                { key: 'description', value: { string_value: 'A desc' } },
                { key: 'domain', value: { string_value: 'example.com' } },
                { key: 'card_url', value: { string_value: 'https://t.co/card' } },
                { key: 'thumbnail_image_large', value: { image_value: { url: 'https://pbs.twimg.com/thumb.jpg' } } },
              ],
            },
          },
        }
      )
    );
    expect(node.linkCard).toEqual({
      type: 'linkCard',
      url: 'https://t.co/card',
      title: 'A Title',
      description: 'A desc',
      imageUrl: 'https://pbs.twimg.com/thumb.jpg',
      domain: 'example.com',
    });
  });
});
