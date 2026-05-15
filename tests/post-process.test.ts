import { describe, expect, it } from 'vitest';
import { postProcess } from '../src/shared/post-process';
import type { ExtractedContent } from '../src/types/messages';

function content(markdown: string): ExtractedContent {
  return {
    type: 'tweet',
    author: { name: 'Example', handle: '@example' },
    markdown,
    sourceUrl: 'https://x.com/example/status/123',
    date: '2026-05-11T00:00:00.000Z',
    tweetId: '123',
  };
}

describe('postProcess() image downloads', () => {
  it('does not download link card preview images even on pbs.twimg.com', () => {
    const cardUrl = 'https://pbs.twimg.com/media/HEut_fPXkAA_Opf?format=jpg&name=large';
    const result = postProcess(
      content(`> ![Link card preview](${cardUrl})`),
      { includeMetadata: false, downloadImages: true }
    );

    expect(result.markdown).toContain(`![Link card preview](${cardUrl})`);
    expect(result.images).toEqual([]);
  });

  it('localizes only allowed X/Twitter media images', () => {
    const allowedUrl = 'https://pbs.twimg.com/media/example?format=jpg&name=large';
    const externalUrl = 'https://example.com/card.jpg';
    const result = postProcess(
      content(`![Allowed](${allowedUrl})\n![External](${externalUrl})`),
      { includeMetadata: false, downloadImages: true }
    );

    expect(result.markdown).toContain('![Allowed](example-123/example.jpg)');
    expect(result.markdown).toContain(`![External](${externalUrl})`);
    expect(result.images).toEqual([
      { url: allowedUrl, filename: 'example-123/example.jpg' },
    ]);
  });
});
