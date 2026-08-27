import { describe, expect, it } from 'vitest';
import {
  aiZipFilename,
  buildAiZipEntries,
  normalizeZipEntryName,
} from '../src/background/ai-zip';

describe('buildAiZipEntries()', () => {
  it('packages Markdown plus allowed media using the existing relative names', async () => {
    const allowedUrl = 'https://pbs.twimg.com/media/example?format=jpg&name=large';
    const loaded: string[] = [];

    const entries = await buildAiZipEntries(
      {
        action: 'DOWNLOAD_AI_ZIP',
        content: '# Example\n\n![Image](example-123/example.jpg)',
        filename: 'example-123.md',
        images: [
          { url: allowedUrl, filename: 'example-123/example.jpg' },
          { url: 'https://example.com/not-x-media.jpg', filename: 'example-123/card.jpg' },
        ],
      },
      async (url) => {
        loaded.push(url);
        return new Uint8Array([0, 255, 80, 75]);
      }
    );

    expect(loaded).toEqual([allowedUrl]);
    expect(entries).toEqual([
      { name: 'example-123.md', content: '# Example\n\n![Image](example-123/example.jpg)' },
      { name: 'example-123/example.jpg', content: new Uint8Array([0, 255, 80, 75]) },
    ]);
  });

  it('skips duplicate archive paths', async () => {
    const entries = await buildAiZipEntries(
      {
        action: 'DOWNLOAD_AI_ZIP',
        content: '# Example',
        filename: 'example.md',
        images: [
          { url: 'https://pbs.twimg.com/media/one?format=jpg', filename: 'example/image.jpg' },
          { url: 'https://pbs.twimg.com/media/two?format=jpg', filename: 'example/image.jpg' },
        ],
      },
      async () => new Uint8Array([1])
    );

    expect(entries).toHaveLength(2);
    expect(entries[1]).toEqual({ name: 'example/image.jpg', content: new Uint8Array([1]) });
  });
});

describe('aiZipFilename()', () => {
  it('replaces a Markdown extension with .zip', () => {
    expect(aiZipFilename('example-123.md')).toBe('example-123.zip');
  });

  it('appends .zip when the filename has no Markdown extension', () => {
    expect(aiZipFilename('example-123')).toBe('example-123.zip');
  });
});

describe('normalizeZipEntryName()', () => {
  it('keeps useful relative paths while dropping traversal segments', () => {
    expect(normalizeZipEntryName('../thread media/./image.jpg')).toBe('thread media/image.jpg');
  });

  it('returns null for empty paths', () => {
    expect(normalizeZipEntryName('../..')).toBeNull();
  });
});
