import { describe, it, expect } from 'vitest';
import { collectMedia, isDownloadableVideo, isProgressiveMp4 } from '../src/ast/collect-media';
import type { Document, MediaItem, TweetNode } from '../src/ast/types';

const author = { name: 'Example', handle: 'example' };
const date = '2026-01-01T00:00:00.000Z';

function tweet(tweetId: string, media: MediaItem[] = [], quotedTweet?: TweetNode): TweetNode {
  return {
    type: 'tweet',
    author,
    date,
    tweetId,
    text: [],
    media,
    ...(quotedTweet ? { quotedTweet } : {}),
  };
}

function document(body: Document['body']): Document {
  return {
    version: 1,
    metadata: {
      type: body.type,
      sourceUrl: 'https://x.com/example/status/1',
      tweetId: '1',
      author,
      date,
    },
    body,
  };
}

describe('collectMedia()', () => {
  it('collects a tweet media before its quoted tweet media', () => {
    const doc = document(tweet(
      '1',
      [
        { kind: 'image', url: 'https://images.example/root.jpg' },
        { kind: 'video', url: 'https://video.example/root.mp4', posterUrl: 'https://images.example/root-poster.jpg' },
      ],
      tweet('2', [
        { kind: 'gif', url: 'https://video.example/quote.mp4', posterUrl: 'https://images.example/quote-poster.jpg' },
      ])
    ));

    expect(collectMedia(doc)).toEqual([
      { kind: 'image', url: 'https://images.example/root.jpg', tweetId: '1' },
      {
        kind: 'video',
        url: 'https://video.example/root.mp4',
        posterUrl: 'https://images.example/root-poster.jpg',
        tweetId: '1',
      },
      {
        kind: 'gif',
        url: 'https://video.example/quote.mp4',
        posterUrl: 'https://images.example/quote-poster.jpg',
        tweetId: '2',
      },
    ]);
  });

  it('collects each thread tweet and its quote in thread order', () => {
    const doc = document({
      type: 'thread',
      tweets: [
        tweet('1', [{ kind: 'image', url: 'https://images.example/first.jpg' }]),
        tweet(
          '2',
          [{ kind: 'video', url: 'https://video.example/second.mp4', posterUrl: 'https://images.example/second-poster.jpg' }],
          tweet('3', [{ kind: 'image', url: 'https://images.example/quote.jpg' }])
        ),
      ],
    });

    expect(collectMedia(doc).map((media) => media.url)).toEqual([
      'https://images.example/first.jpg',
      'https://video.example/second.mp4',
      'https://images.example/quote.jpg',
    ]);
  });

  it('walks nested article blocks in order and uses video sourceUrl', () => {
    const doc = document({
      type: 'article',
      children: [
        { type: 'image', url: 'https://images.example/first.jpg' },
        {
          type: 'blockquote',
          children: [
            {
              type: 'video',
              posterUrl: 'https://images.example/block-poster.jpg',
              sourceUrl: 'https://video.example/block.mp4',
            },
          ],
        },
        tweet(
          '4',
          [{ kind: 'image', url: 'https://images.example/embed.jpg' }],
          tweet('5', [{ kind: 'gif', url: 'https://video.example/quoted.mp4' }])
        ),
        {
          type: 'list',
          ordered: false,
          children: [
            {
              type: 'listItem',
              children: [
                { type: 'image', url: 'https://images.example/list.jpg' },
                {
                  type: 'thread',
                  tweets: [tweet('6', [{ kind: 'video', url: 'https://video.example/thread.mp4' }])],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(collectMedia(doc)).toEqual([
      { kind: 'image', url: 'https://images.example/first.jpg' },
      {
        kind: 'video',
        url: 'https://video.example/block.mp4',
        posterUrl: 'https://images.example/block-poster.jpg',
      },
      { kind: 'image', url: 'https://images.example/embed.jpg', tweetId: '4' },
      { kind: 'gif', url: 'https://video.example/quoted.mp4', tweetId: '5' },
      { kind: 'image', url: 'https://images.example/list.jpg' },
      { kind: 'video', url: 'https://video.example/thread.mp4', tweetId: '6' },
    ]);
  });

  it('collects a posterless article MP4 as downloadable video', () => {
    const mp4 = 'https://video.twimg.com/ext_tw_video/x/clip.mp4?tag=12';
    const [media] = collectMedia(document({
      type: 'article',
      children: [{ type: 'video', sourceUrl: mp4 }],
    }));

    expect(media).toEqual({ kind: 'video', url: mp4 });
    expect(media).not.toHaveProperty('posterUrl');
    expect(isDownloadableVideo(media)).toBe(true);
  });
});

describe('isDownloadableVideo()', () => {
  it('accepts progressive videos and gifs but rejects images and poster-only video', () => {
    expect(isDownloadableVideo({ kind: 'video', url: 'https://video.twimg.com/video.mp4' })).toBe(true);
    expect(isDownloadableVideo({ kind: 'gif', url: 'https://video.twimg.com/gif.mp4' })).toBe(true);
    expect(isDownloadableVideo({ kind: 'image', url: 'https://images.example/image.mp4' })).toBe(false);
    expect(isDownloadableVideo({
      kind: 'video',
      url: 'https://video.twimg.com/poster.mp4',
      posterUrl: 'https://video.twimg.com/poster.mp4',
    })).toBe(false);
  });

  it('rejects an MP4 outside video.twimg.com', () => {
    const mp4 = 'https://pbs.twimg.com/x/clip.mp4';
    expect(isDownloadableVideo({ kind: 'video', url: mp4 })).toBe(false);
  });
});

describe('isProgressiveMp4()', () => {
  it('requires HTTPS, video.twimg.com, and an MP4 pathname', () => {
    expect(isProgressiveMp4('https://video.twimg.com/ext_tw_video/x/clip.mp4?tag=12')).toBe(true);
    expect(isProgressiveMp4('https://pbs.twimg.com/x/clip.mp4')).toBe(false);
    expect(isProgressiveMp4('https://video.example/path/clip.m3u8')).toBe(false);
    expect(isProgressiveMp4('http://video.twimg.com/path/clip.mp4')).toBe(false);
    expect(isProgressiveMp4('not a URL')).toBe(false);
  });
});
