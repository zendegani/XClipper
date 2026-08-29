import { describe, it, expect, vi } from 'vitest';
import type { Document } from '../src/ast/types';
import { resolveLocalVideo } from '../src/shared/local-video';

const POSTER = 'https://pbs.twimg.com/amplify_video_thumb/2076673758748639232/img/YpAYEsLVDS7JMxGE.jpg';
const MP4 = 'https://video.twimg.com/amplify_video/2076673758748639232/vid/avc1/1280x720/x1MQ3cIsSkCfu1P1.mp4';

// An X Article whose body holds one video — the shape the DOM extractor
// produces, where sourceUrl is still the poster.
function articleWithVideo(): Document {
  return {
    version: 1,
    metadata: {
      type: 'article',
      sourceUrl: 'https://x.com/DeRonin_/status/2076690611399176506',
      tweetId: '2076690611399176506',
      author: { name: 'Ronin', handle: '@DeRonin_' },
      date: '2026-06-28T18:03:20.000Z',
    },
    body: {
      type: 'article',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'Before' }] },
        { type: 'video', sourceUrl: POSTER, posterUrl: POSTER },
      ],
    },
  };
}

describe('resolveLocalVideo()', () => {
  it('fills an article-body video with its MP4 and reports it as an attachment', async () => {
    const doc = articleWithVideo();

    const result = await resolveLocalVideo(doc, '2076690611399176506', async () => [
      ['/amplify_video_thumb/2076673758748639232/img/ypayeslvds7jmxge.jpg', MP4],
    ]);

    expect(result).toEqual({
      status: 'resolved',
      attachments: [{ renderedUrl: MP4, downloadUrl: MP4 }],
    });
    if (doc.body.type !== 'article') throw new Error('expected an article');
    expect(doc.body.children[1]).toEqual({ type: 'video', sourceUrl: MP4, posterUrl: POSTER });
  });

  it('skips the round trip when nothing carries an unresolved video', async () => {
    const fetchMp4Urls = vi.fn(async () => []);
    const doc = articleWithVideo();
    if (doc.body.type !== 'article') throw new Error('expected an article');
    doc.body.children = [{ type: 'paragraph', children: [{ type: 'text', value: 'No media' }] }];

    expect(await resolveLocalVideo(doc, '2076690611399176506', fetchMp4Urls)).toEqual({ status: 'none' });
    expect(fetchMp4Urls).not.toHaveBeenCalled();
  });

  it('leaves the poster in place when the background resolves nothing', async () => {
    const doc = articleWithVideo();

    expect(await resolveLocalVideo(doc, '2076690611399176506', async () => [])).toEqual({
      status: 'unresolved',
    });
    if (doc.body.type !== 'article') throw new Error('expected an article');
    expect(doc.body.children[1]).toEqual({ type: 'video', sourceUrl: POSTER, posterUrl: POSTER });
  });
});
