import { describe, expect, it } from 'vitest';
import { buildSingleZipEntries, zipFilenameFor } from '../src/background/single-zip';

const bytes = (...n: number[]): Uint8Array => new Uint8Array(n);

describe('buildSingleZipEntries()', () => {
  it('packs the Markdown plus allowed media under the paths the Markdown links to', async () => {
    const fetched: string[] = [];
    const entries = await buildSingleZipEntries(
      '# Post\n\n![Image](post-123/AAA.jpg)',
      'post-123.md',
      [
        { url: 'https://pbs.twimg.com/media/AAA?format=jpg&name=large', filename: 'post-123/AAA.jpg' },
        { url: 'https://video.twimg.com/amplify_video/1/vid/720x1280/BBB.mp4', filename: 'post-123/BBB.mp4' },
      ],
      async (url) => {
        fetched.push(url);
        return bytes(0, 255, 80, 75);
      }
    );

    expect(fetched).toHaveLength(2);
    expect(entries.map((e) => e.name)).toEqual(['post-123.md', 'post-123/AAA.jpg', 'post-123/BBB.mp4']);
    expect(entries[1].content).toEqual(bytes(0, 255, 80, 75));
  });

  it('skips media on a host the allowlist rejects, without fetching it', async () => {
    const fetched: string[] = [];
    const entries = await buildSingleZipEntries(
      '# Post',
      'post.md',
      [{ url: 'https://evil.example.com/x.jpg', filename: 'post/x.jpg' }],
      async (url) => {
        fetched.push(url);
        return bytes(1);
      }
    );

    expect(fetched).toEqual([]);
    expect(entries.map((e) => e.name)).toEqual(['post.md']);
  });

  // The whole reason the loader returns null rather than throwing: one expired
  // media URL must cost the user that image, not the entire export.
  it('keeps the Markdown and the other media when one fetch fails', async () => {
    const entries = await buildSingleZipEntries(
      '# Post',
      'post.md',
      [
        { url: 'https://pbs.twimg.com/media/GONE?format=jpg', filename: 'post/gone.jpg' },
        { url: 'https://pbs.twimg.com/media/OK?format=jpg', filename: 'post/ok.jpg' },
      ],
      async (url) => (url.includes('GONE') ? null : bytes(7))
    );

    expect(entries.map((e) => e.name)).toEqual(['post.md', 'post/ok.jpg']);
  });

  it('strips traversal segments out of entry names', async () => {
    const entries = await buildSingleZipEntries(
      '# Post',
      '../../etc/passwd.md',
      [{ url: 'https://pbs.twimg.com/media/A?format=jpg', filename: '../../../evil.jpg' }],
      async () => bytes(1)
    );

    expect(entries.map((e) => e.name)).toEqual(['etc/passwd.md', 'evil.jpg']);
  });

  it('does not add a second entry under a name already taken', async () => {
    const entries = await buildSingleZipEntries(
      '# Post',
      'post.md',
      [
        { url: 'https://pbs.twimg.com/media/ONE?format=jpg', filename: 'post/same.jpg' },
        { url: 'https://pbs.twimg.com/media/TWO?format=jpg', filename: 'post/same.jpg' },
      ],
      async () => bytes(1)
    );

    expect(entries).toHaveLength(2);
  });
});

describe('zipFilenameFor()', () => {
  it('swaps the extension for .zip', () => {
    expect(zipFilenameFor('post-123.md')).toBe('post-123.zip');
    expect(zipFilenameFor('post-123.json')).toBe('post-123.zip');
  });

  it('appends .zip when there is no extension', () => {
    expect(zipFilenameFor('post-123')).toBe('post-123.zip');
  });

  // A dot in the filename template must not be mistaken for an extension.
  it('leaves a dotted directory prefix alone', () => {
    expect(zipFilenameFor('2026.08.28-post.md')).toBe('2026.08.28-post.zip');
  });
});
