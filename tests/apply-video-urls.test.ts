import { describe, expect, it } from 'vitest';
import { applyVideoUrls, posterKey } from '../src/ast/apply-video-urls';
import { collectMedia, isDownloadableVideo } from '../src/ast/collect-media';
import { renderMarkdown } from '../src/ast/render-markdown';
import type { Document, MediaItem, TweetNode } from '../src/ast/types';

const POSTER = 'https://pbs.twimg.com/amplify_video_thumb/1/img/HE6Z.jpg';
const MP4 = 'https://video.twimg.com/amplify_video/1/vid/720x1280/HE6Z.mp4';

// A DOM-extracted video: the poster stands in for the source, because that is
// all the page exposes.
const domVideo = (poster = POSTER): MediaItem => ({
  kind: 'video',
  url: poster,
  posterUrl: poster,
});

const tweet = (media: MediaItem[]): TweetNode => ({
  type: 'tweet',
  tweetId: '1',
  author: { name: 'A', handle: 'a' },
  date: '2026-01-01T00:00:00.000Z',
  text: [],
  media,
});

const doc = (body: TweetNode): Document => ({
  metadata: {
    type: 'tweet',
    author: { name: 'A', handle: 'a' },
    sourceUrl: 'https://x.com/a/status/1',
    date: '2026-01-01T00:00:00.000Z',
    tweetId: '1',
  },
  body,
});

describe('applyVideoUrls()', () => {
  it('fills in the MP4 and leaves the poster alone', () => {
    const d = doc(tweet([domVideo()]));

    expect(applyVideoUrls(d, new Map([[posterKey(POSTER)!, MP4]]))).toBe(1);
    expect((d.body as TweetNode).media[0]).toEqual({
      kind: 'video',
      url: MP4,
      posterUrl: POSTER,
    });
  });

  // The DOM and the GraphQL payload agree on the path but not the query string.
  it('matches on the poster path, ignoring query strings', () => {
    const d = doc(tweet([domVideo(POSTER + '?format=jpg&name=small')]));

    expect(applyVideoUrls(d, new Map([[posterKey(POSTER)!, MP4]]))).toBe(1);
  });

  it('leaves a video alone when nothing resolved for it', () => {
    const d = doc(tweet([domVideo()]));

    expect(applyVideoUrls(d, new Map([['/other/path.jpg', MP4]]))).toBe(0);
    expect((d.body as TweetNode).media[0].url).toBe(POSTER);
  });

  it('does not overwrite a node that already carries a real source', () => {
    const d = doc(tweet([{ kind: 'video', url: MP4, posterUrl: POSTER }]));

    expect(applyVideoUrls(d, new Map([[posterKey(POSTER)!, 'https://video.twimg.com/other.mp4']]))).toBe(0);
    expect((d.body as TweetNode).media[0].url).toBe(MP4);
  });

  it('reaches videos inside a quoted post', () => {
    const quoted = tweet([domVideo()]);
    const d = doc({ ...tweet([]), quotedTweet: quoted });

    expect(applyVideoUrls(d, new Map([[posterKey(POSTER)!, MP4]]))).toBe(1);
  });

  it('is a no-op for an empty map', () => {
    const d = doc(tweet([domVideo()]));
    expect(applyVideoUrls(d, new Map())).toBe(0);
  });

  // The point of the whole exercise: once the node carries a real source, the
  // existing renderer and media collector treat it as a downloadable video
  // with no changes of their own.
  it('makes the node downloadable and renders a video link', () => {
    const d = doc(tweet([domVideo()]));
    applyVideoUrls(d, new Map([[posterKey(POSTER)!, MP4]]));

    expect(collectMedia(d).filter(isDownloadableVideo)).toHaveLength(1);
    expect(renderMarkdown(d, { includeVideoLinks: true })).toContain(`[▶ Video](${MP4})`);
  });

  it('renders only the thumbnail while the video is unresolved', () => {
    const d = doc(tweet([domVideo()]));

    expect(collectMedia(d).filter(isDownloadableVideo)).toHaveLength(0);
    expect(renderMarkdown(d, { includeVideoLinks: true })).not.toContain('[▶ Video]');
  });
});
