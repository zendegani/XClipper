import { describe, it, expect } from 'vitest';
import type { Document, MediaItem } from '../src/ast/types';
import { renderDigest } from '../src/ast/render-digest';
import { docToExtracted } from '../src/background/batch-sink';

function tweetDoc(handle: string, text: string, id: string, media: MediaItem[] = []): Document {
  return {
    version: 1,
    metadata: {
      type: 'tweet',
      sourceUrl: `https://x.com/${handle}/status/${id}`,
      tweetId: id,
      author: { name: handle, handle },
      date: '2026-06-11',
    },
    body: {
      type: 'tweet',
      author: { name: handle, handle },
      date: '2026-06-11',
      tweetId: id,
      text: [{ type: 'text', value: text }],
      media,
    },
  };
}

describe('renderDigest', () => {
  it('joins rendered documents with separators', () => {
    const digest = renderDigest([tweetDoc('alice', 'first', '1'), tweetDoc('bob', 'second', '2')]);
    expect(digest).toContain('# alice (@alice)');
    expect(digest).toContain('first');
    expect(digest).toContain('# bob (@bob)');
    expect(digest).toContain('second');
    // Item separator between the two documents.
    expect(digest).toContain('> Source: https://x.com/alice/status/1');
    expect(digest.indexOf('# bob')).toBeGreaterThan(digest.indexOf('> Source: https://x.com/alice/status/1'));
    expect(digest.endsWith('\n')).toBe(true);
  });

  it('renders a single document without trailing separator noise', () => {
    const digest = renderDigest([tweetDoc('alice', 'only', '1')]);
    expect(digest.trim().endsWith('> Date: 2026-06-11')).toBe(true);
  });

  it('keeps real MP4s poster-only in a combined digest', () => {
    const mp4 = 'https://video.twimg.com/vid/clip.mp4?tag=27';
    const digest = renderDigest([tweetDoc('alice', 'with video', '1', [{
      kind: 'video',
      url: mp4,
      posterUrl: 'https://pbs.twimg.com/media/poster.jpg',
    }])]);

    expect(digest).not.toContain(mp4);
    expect(digest).not.toContain('alice-1/clip.mp4');
  });
});

describe('docToExtracted video-link option', () => {
  it('enables video links only when the caller opts in', () => {
    const mp4 = 'https://video.twimg.com/vid/clip.mp4?tag=27';
    const doc = tweetDoc('alice', 'with video', '1', [{
      kind: 'video',
      url: mp4,
      posterUrl: 'https://pbs.twimg.com/media/poster.jpg',
    }]);

    expect(docToExtracted(doc).markdown).not.toContain(mp4);
    expect(docToExtracted(doc, { includeVideoLinks: true }).markdown)
      .toContain(`[▶ Video](${mp4})`);
  });
});
