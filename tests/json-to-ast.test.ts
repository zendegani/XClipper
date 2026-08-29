import { describe, it, expect } from 'vitest';
import { articleEmbeddedTweetIds, jsonToAst, jsonToTweetNode } from '../src/graphql/json-to-ast';
import { renderMarkdown } from '../src/ast/render-markdown';
import { isDownloadableVideo } from '../src/ast/collect-media';

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

  // X's UI shows reposts and quotes as one number and the DOM extractor reads
  // that label, so the mapper sums the payload's two fields to match (#125).
  // Verified against a real capture: 165 retweets + 66 quotes = the 231 a DOM
  // run reported for the same post.
  it('reports reposts as retweets plus quotes', () => {
    const doc = jsonToAst(tweet({ retweet_count: 165, quote_count: 66 }));
    expect(doc.metadata.engagement?.reposts).toBe(231);
  });

  it('falls back to the retweet count alone when quote_count is absent', () => {
    const doc = jsonToAst(tweet({ retweet_count: 165 }));
    expect(doc.metadata.engagement?.reposts).toBe(165);
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

  it('decodes &amp; last so &amp;lt; is a literal &lt;, not <', () => {
    const node = jsonToTweetNode(tweet({ full_text: 'a &amp;lt; b &amp; c' }));
    expect(node.text).toEqual([{ type: 'text', value: 'a &lt; b & c' }]);
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

// X's real variant shape: a resolution ladder with the frame size in the URL
// path, plus an HLS stream carrying no bitrate.
const VID = 'https://video.twimg.com/ext_tw_video/1/pu/vid/avc1';
const ladder = () => [
  { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/ext_tw_video/1/pu/pl/x.m3u8' },
  { content_type: 'video/mp4', bitrate: 256000, url: `${VID}/480x270/a.mp4` },
  { content_type: 'video/mp4', bitrate: 832000, url: `${VID}/640x360/b.mp4` },
  { content_type: 'video/mp4', bitrate: 2176000, url: `${VID}/1280x720/c.mp4` },
  { content_type: 'video/mp4', bitrate: 10368000, url: `${VID}/1920x1080/d.mp4` },
];

describe('jsonToTweetNode — media', () => {
  it('picks the highest-bitrate mp4 within the 720p cap', () => {
    const node = jsonToTweetNode(
      tweet({
        extended_entities: {
          media: [
            { type: 'photo', media_url_https: 'https://pbs.twimg.com/p.jpg', ext_alt_text: 'a cat' },
            {
              type: 'video',
              media_url_https: 'https://pbs.twimg.com/poster.jpg',
              video_info: { variants: ladder() },
            },
          ],
        },
      })
    );
    expect(node.media).toEqual([
      { kind: 'image', url: 'https://pbs.twimg.com/p.jpg', alt: 'a cat' },
      { kind: 'video', url: `${VID}/1280x720/c.mp4`, posterUrl: 'https://pbs.twimg.com/poster.jpg' },
    ]);
  });

  // The cap exists because the top rung can be 4K: one 18-minute 4K article
  // video measured 784MB, against ~13MB for the same post at 720p.
  it('skips the 1080p and 4K rungs even though they are higher bitrate', () => {
    const node = jsonToTweetNode(
      tweet({
        extended_entities: {
          media: [
            { type: 'video', video_info: { variants: ladder() } },
          ],
        },
      })
    );
    expect(node.media[0].url).toBe(`${VID}/1280x720/c.mp4`);
  });

  // A ladder we can't read the frame size from, or one where every rung is
  // oversized, fails small rather than risking the gigabyte-scale rung.
  it('falls back to the smallest mp4 when no variant URL carries a frame size', () => {
    const node = jsonToTweetNode(
      tweet({
        extended_entities: {
          media: [
            {
              type: 'video',
              video_info: {
                variants: [
                  { content_type: 'video/mp4', bitrate: 256000, url: 'https://video/low.mp4' },
                  { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video/high.mp4' },
                ],
              },
            },
          ],
        },
      })
    );
    expect(node.media[0].url).toBe('https://video/low.mp4');
  });

  it('falls back to the smallest mp4 when every rung is above the cap', () => {
    const node = jsonToTweetNode(
      tweet({
        extended_entities: {
          media: [
            {
              type: 'video',
              video_info: {
                variants: [
                  { content_type: 'video/mp4', bitrate: 10368000, url: `${VID}/1920x1080/d.mp4` },
                  { content_type: 'video/mp4', bitrate: 41000000, url: `${VID}/3324x2160/e.mp4` },
                ],
              },
            },
          ],
        },
      })
    );
    expect(node.media[0].url).toBe(`${VID}/1920x1080/d.mp4`);
  });

  it('keeps an HLS-only variant as a non-downloadable fallback', () => {
    const node = jsonToTweetNode(
      tweet({
        extended_entities: {
          media: [
            {
              type: 'video',
              media_url_https: 'https://pbs.twimg.com/poster.jpg',
              video_info: {
                variants: [{ content_type: 'application/x-mpegURL', url: 'https://video/x.m3u8' }],
              },
            },
          ],
        },
      })
    );

    expect(node.media).toEqual([
      { kind: 'video', url: 'https://video/x.m3u8', posterUrl: 'https://pbs.twimg.com/poster.jpg' },
    ]);
    expect(isDownloadableVideo(node.media[0])).toBe(false);
  });

  it('maps a video without a poster URL', () => {
    const node = jsonToTweetNode(
      tweet({
        extended_entities: {
          media: [
            {
              type: 'video',
              video_info: {
                variants: [{ content_type: 'video/mp4', url: 'https://video/clip.mp4' }],
              },
            },
          ],
        },
      })
    );

    expect(node.media).toEqual([{ kind: 'video', url: 'https://video/clip.mp4' }]);
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
      banner: { type: 'image', url: 'https://pbs.twimg.com/media/cover?format=jpg&name=large' },
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
      { type: 'image', url: 'https://pbs.twimg.com/media/pic?format=jpg&name=large' },
    ]);
  });

  it('maps a progressive article video without preview_image to a posterless VideoNode', () => {
    const mp4 = 'https://video.twimg.com/ext_tw_video/x/clip.mp4?tag=12';
    const result = {
      ...articleResult,
      article: {
        article_results: {
          result: {
            ...articleResult.article.article_results.result,
            media_entities: [
              {
                media_id: 'video-1',
                media_info: {
                  variants: [{ content_type: 'video/mp4', url: mp4, bitrate: 832000 }],
                },
              },
            ],
            content_state: {
              blocks: [{ type: 'atomic', text: ' ', entityRanges: [{ key: 0, offset: 0, length: 1 }] }],
              entityMap: [
                {
                  key: '0',
                  value: { type: 'MEDIA', data: { mediaItems: [{ mediaId: 'video-1' }] } },
                },
              ],
            },
          },
        },
      },
    };

    const body = jsonToAst(result).body as { type: 'article'; children: unknown[] };
    expect(body.children).toEqual([{ type: 'video', sourceUrl: mp4 }]);
  });

  // Atomic DIVIDER entities → thematic break; `blockquote` blocks (grouped when
  // consecutive) → blockquote; a leading "\n" (common on Draft headings) is
  // trimmed, not turned into a stray break.
  it('maps dividers, blockquotes, and trims a leading newline on headings', () => {
    const result = {
      ...articleResult,
      article: {
        article_results: {
          result: {
            ...articleResult.article.article_results.result,
            content_state: {
              blocks: [
                { type: 'header-two', text: '\nA Heading' },
                { type: 'atomic', text: ' ', entityRanges: [{ key: 0, offset: 0, length: 1 }] },
                { type: 'blockquote', text: 'first line' },
                { type: 'blockquote', text: 'second line' },
                { type: 'unstyled', text: 'after' },
              ],
              entityMap: [{ key: '0', value: { type: 'DIVIDER', data: {} } }],
            },
          },
        },
      },
    };
    const body = jsonToAst(result).body as { children: unknown[] };
    expect(body.children).toEqual([
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'A Heading' }] },
      { type: 'thematicBreak' },
      {
        type: 'blockquote',
        children: [
          { type: 'paragraph', children: [{ type: 'text', value: 'first line' }] },
          { type: 'paragraph', children: [{ type: 'text', value: 'second line' }] },
        ],
      },
      { type: 'paragraph', children: [{ type: 'text', value: 'after' }] },
    ]);
  });

  // Code blocks and tables are the one part of an article X does NOT send as
  // structured Draft.js — an atomic MARKDOWN entity holds raw markdown source.
  // Before these were mapped, every code block and table in a Fast Batch
  // export was silently dropped.
  const withMarkdownEntities = (...markdown: string[]) => ({
    ...articleResult,
    article: {
      article_results: {
        result: {
          ...articleResult.article.article_results.result,
          content_state: {
            blocks: markdown.map((_, i) => ({
              type: 'atomic',
              text: ' ',
              entityRanges: [{ key: i, offset: 0, length: 1 }],
            })),
            entityMap: markdown.map((md, i) => ({
              key: String(i),
              value: { type: 'MARKDOWN', data: { markdown: md } },
            })),
          },
        },
      },
    },
  });

  const blocksOf = (result: unknown): unknown[] =>
    (jsonToAst(result).body as { children: unknown[] }).children;

  it('maps a MARKDOWN entity holding a fenced code block', () => {
    expect(blocksOf(withMarkdownEntities('```bash\n/loop 5m check my PR\n\n```'))).toEqual([
      { type: 'code', lang: 'bash', value: '/loop 5m check my PR' },
    ]);
  });

  it('maps an unfenced-language code block without a lang', () => {
    expect(blocksOf(withMarkdownEntities('```\nplain\n```'))).toEqual([
      { type: 'code', value: 'plain' },
    ]);
  });

  it('maps a MARKDOWN entity holding a GFM table, with cell formatting', () => {
    const md = '| **Loop**  | **Reach for**  |\n| --- | --- |\n|  Turn-based | `/goal` |';
    expect(blocksOf(withMarkdownEntities(md))).toEqual([
      {
        type: 'table',
        header: {
          type: 'tableRow',
          children: [
            { type: 'tableCell', children: [{ type: 'strong', children: [{ type: 'text', value: 'Loop' }] }] },
            { type: 'tableCell', children: [{ type: 'strong', children: [{ type: 'text', value: 'Reach for' }] }] },
          ],
        },
        children: [
          {
            type: 'tableRow',
            children: [
              { type: 'tableCell', children: [{ type: 'text', value: 'Turn-based' }] },
              { type: 'tableCell', children: [{ type: 'inlineCode', value: '/goal' }] },
            ],
          },
        ],
      },
    ]);
  });

  it('treats a table with no delimiter row as all-data, and unescapes cell pipes', () => {
    const block = blocksOf(withMarkdownEntities('| a \\| b | c |'))[0] as {
      type: string;
      header?: unknown;
      children: { children: { children: unknown[] }[] }[];
    };
    expect(block.type).toBe('table');
    expect(block.header).toBeUndefined();
    expect(block.children[0].children[0].children).toEqual([{ type: 'text', value: 'a | b' }]);
  });

  it('parses links and italics inside a cell', () => {
    const md = '| x |\n| --- |\n| see [docs](https://example.com) and *this* |';
    const row = (blocksOf(withMarkdownEntities(md))[0] as {
      children: { children: { children: unknown[] }[] }[];
    }).children[0];
    expect(row.children[0].children).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: 'docs' }] },
      { type: 'text', value: ' and ' },
      { type: 'emphasis', children: [{ type: 'text', value: 'this' }] },
    ]);
  });

  it('drops a MARKDOWN entity whose shape is neither a fence nor a table', () => {
    expect(blocksOf(withMarkdownEntities('just some prose'))).toEqual([]);
  });

  // X's editor marks every heading's text Bold, which rendered as
  // `## **Heading**` — the `##` already carries that. Partial bold is the
  // author's own emphasis and survives. Keeps parity with the DOM extractor.
  const withHeading = (text: string, styles: unknown[]) => ({
    ...articleResult,
    article: {
      article_results: {
        result: {
          ...articleResult.article.article_results.result,
          content_state: {
            blocks: [{ type: 'header-two', text, inlineStyleRanges: styles }],
            entityMap: [],
          },
        },
      },
    },
  });

  it('drops the bold X puts on a whole heading', () => {
    const result = withHeading('Getting started', [{ style: 'Bold', offset: 0, length: 15 }]);
    expect(blocksOf(result)).toEqual([
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Getting started' }] },
    ]);
    expect(renderMarkdown(jsonToAst(result))).toContain('## Getting started');
  });

  it('keeps bold on part of a heading', () => {
    const result = withHeading('Getting started', [{ style: 'Bold', offset: 0, length: 7 }]);
    expect(blocksOf(result)).toEqual([
      {
        type: 'heading',
        depth: 2,
        children: [
          { type: 'strong', children: [{ type: 'text', value: 'Getting' }] },
          { type: 'text', value: ' started' },
        ],
      },
    ]);
  });

  // A post embedded in the article body arrives as a TWEET entity carrying only
  // a tweetId — the tweet's own content is nowhere in the payload, so the caller
  // fetches it and passes it in. Before this, the entity fell through and the
  // embed vanished from the export (issue #123).
  const withEmbeddedTweet = (tweetId: string) => ({
    ...articleResult,
    article: {
      article_results: {
        result: {
          ...articleResult.article.article_results.result,
          content_state: {
            blocks: [
              { type: 'unstyled', text: 'before' },
              { type: 'atomic', text: ' ', entityRanges: [{ key: 0, offset: 0, length: 1 }] },
              { type: 'unstyled', text: 'after' },
            ],
            entityMap: [{ key: '0', value: { type: 'TWEET', data: { tweetId } } }],
          },
        },
      },
    },
  });

  it('maps a TWEET entity to the fetched post', () => {
    const embedded = jsonToTweetNode(tweet({ id_str: '777', full_text: 'the embedded post' }, { rest_id: '777' }));
    const doc = jsonToAst(withEmbeddedTweet('777'), undefined, new Map([['777', embedded]]));
    const children = (doc.body as { children: unknown[] }).children;
    expect(children[1]).toEqual(embedded);
    expect(renderMarkdown(doc)).toContain('the embedded post');
  });

  it('falls back to a link when the embedded post was not fetched', () => {
    expect(blocksOf(withEmbeddedTweet('777'))[1]).toEqual({
      type: 'blockquote',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: 'https://x.com/i/status/777',
              children: [{ type: 'text', value: 'Embedded post on X' }],
            },
          ],
        },
      ],
    });
  });

  it('lists the ids of the posts the body embeds', () => {
    expect(articleEmbeddedTweetIds(withEmbeddedTweet('777'))).toEqual(['777']);
    expect(articleEmbeddedTweetIds(articleResult)).toEqual([]);
  });
});

// X's GraphQL returns the canonical media URL; the DOM extractor emits the
// sized variant found on the page. Same image — the mapper normalizes to the
// DOM's form so a post exported either way produces identical markdown.
describe('jsonToAst — media URL parity with the DOM extractor', () => {
  it('rewrites a canonical pbs media URL to the sized variant', () => {
    const node = jsonToTweetNode(
      tweet({
        extended_entities: {
          media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/HMkR1.jpg' }],
        },
      })
    );
    expect(node.media).toEqual([
      { kind: 'image', url: 'https://pbs.twimg.com/media/HMkR1?format=jpg&name=large' },
    ]);
  });

  it('leaves a URL that is already sized, or not a pbs media URL, alone', () => {
    const already = 'https://pbs.twimg.com/media/HMkR1?format=jpg&name=small';
    const foreign = 'https://example.com/pic.jpg';
    const node = jsonToTweetNode(
      tweet({
        extended_entities: {
          media: [
            { type: 'photo', media_url_https: already },
            { type: 'photo', media_url_https: foreign },
          ],
        },
      })
    );
    expect(node.media.map((m) => m.url)).toEqual([already, foreign]);
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
