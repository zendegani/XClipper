import { describe, expect, it } from 'vitest';
import { postProcess, buildFilename, applyFilenameTemplate, applyTagsTemplate, DEFAULT_TAGS_TEMPLATE, deriveBasename } from '../src/shared/post-process';
import type { ExtractedContent } from '../src/types/messages';
import type { Document } from '../src/ast/types';
import { collectMedia, isDownloadableVideo } from '../src/ast/collect-media';
import { docToExtracted } from '../src/shared/extracted-content';

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
  it('emits Obsidian-friendly frontmatter when toggle is on', () => {
    const data: ExtractedContent = {
      type: 'thread',
      author: { name: 'Thariq', handle: '@trq212' },
      markdown: '# Thariq (@trq212)\n\nI put a lot of heart into my technical writing, I hope it\'s useful to you all. Here\'s a pinned thread of everything I\'ve written.',
      sourceUrl: 'https://x.com/trq212/status/2035372716820218141',
      date: '2026-03-21T15:07:25.000Z',
      tweetId: '2035372716820218141',
      metadata: { likes: 635, reposts: 45, replies: 6, bookmarks: 784, views: 169859 },
    };

    const result = postProcess(data, {
      includeMetadata: true,
      downloadImages: false,
      obsidianFriendly: true,
    });

    expect(result.markdown).toContain('title: "Thread by @trq212 on X"');
    expect(result.markdown).toContain('author: "[[@trq212]]"');
    expect(result.markdown).toContain('author_name: "Thariq"');
    expect(result.markdown).toContain('handle: "@trq212"');
    expect(result.markdown).toContain('published: 2026-03-21');
    expect(result.markdown).toMatch(/created: \d{4}-\d{2}-\d{2}/);
    expect(result.markdown).toContain('type: thread');
    expect(result.markdown).toContain('description: "I put a lot of heart into my technical writing');
    expect(result.markdown).toContain('tags: [clippings, x, thread]');
    expect(result.markdown).toContain('likes: 635');
    expect(result.markdown).not.toContain('\ndate: 2026-03-21T15:07:25.000Z');
  });

  it('leaves frontmatter unchanged when Obsidian toggle is off', () => {
    const data: ExtractedContent = {
      type: 'tweet',
      author: { name: 'Example', handle: '@example' },
      markdown: '# Example (@example)\n\nHello world.',
      sourceUrl: 'https://x.com/example/status/123',
      date: '2026-05-11T00:00:00.000Z',
      tweetId: '123',
    };

    const result = postProcess(data, { includeMetadata: true, downloadImages: false });

    expect(result.markdown).toContain('author: "Example"');
    expect(result.markdown).toContain('date: 2026-05-11T00:00:00.000Z');
    expect(result.markdown).not.toContain('published:');
    expect(result.markdown).not.toContain('tags:');
  });

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

describe('deriveBasename()', () => {
  it.each([
    ['https://pbs.twimg.com/media/example?format=jpg&name=large', 'jpg', 'example.jpg'],
    ['https://pbs.twimg.com/media/HIEVJQ4XoAAXNNi.jpg', 'jpg', 'HIEVJQ4XoAAXNNi.jpg'],
  ])('keeps image basenames unchanged for %s', (url, defaultExt, expected) => {
    expect(deriveBasename(url, defaultExt)).toBe(expected);
  });

  it('derives the basename of a real X video URL', () => {
    expect(deriveBasename(
      'https://video.twimg.com/amplify_video/2059311116694757376/vid/avc1/1920x1080/_vGThNd8HNc3yfnk.mp4?tag=27',
      'mp4'
    )).toBe('_vGThNd8HNc3yfnk.mp4');
  });

  it('uses the default extension when the URL pathname has none', () => {
    expect(deriveBasename('https://video.twimg.com/vid/clip', 'mp4')).toBe('clip.mp4');
  });

  it('sanitizes filename characters from the pathname', () => {
    expect(deriveBasename('https://video.twimg.com/vid/clip%20name!.mp4', 'mp4'))
      .toBe('clip_20name_.mp4');
  });
});

describe('postProcess() video attachments', () => {
  const posterUrl = 'https://pbs.twimg.com/media/poster?format=jpg&name=large';
  const videoUrl = 'https://video.twimg.com/amplify_video/2059311116694757376/vid/avc1/1920x1080/_vGThNd8HNc3yfnk.mp4?tag=27';
  const downloadUrl = `${videoUrl}&name=large`;

  it('localizes only video-link tokens, preserves query strings, and deduplicates downloads', () => {
    const result = postProcess(
      content([
        `![🎥 Video](${posterUrl})`,
        `[▶ Video](${videoUrl})`,
        `Mention ${videoUrl}`,
        `[An ordinary link](${videoUrl})`,
      ].join('\n\n')),
      {
        includeMetadata: false,
        downloadImages: true,
        filenameTemplate: '{date}-{handle}',
        videoAttachments: [
          { renderedUrl: videoUrl, downloadUrl },
          { renderedUrl: videoUrl, downloadUrl },
        ],
      }
    );

    expect(result.markdown).toContain('![🎥 Video](2026-05-11-example/poster.jpg)');
    expect(result.markdown).toContain('[▶ Video](2026-05-11-example/_vGThNd8HNc3yfnk.mp4)');
    expect(result.markdown).toContain(`Mention ${videoUrl}`);
    expect(result.markdown).toContain(`[An ordinary link](${videoUrl})`);
    expect(result.images).toEqual([
      { url: posterUrl, filename: '2026-05-11-example/poster.jpg' },
      { url: downloadUrl, filename: '2026-05-11-example/_vGThNd8HNc3yfnk.mp4' },
    ]);
  });

  // buildFilename strips path separators but not '$'. Replacement STRINGS read
  // '$1' back as a capture group, so the local path has to go in via a
  // replacer function or a templated folder name corrupts every video link.
  it('survives a filename template containing a dollar sign', () => {
    const result = postProcess(
      content(`Watch this.\n\n[▶ Video](${videoUrl})`),
      {
        includeMetadata: false,
        downloadImages: true,
        filenameTemplate: '$1-{handle}',
        videoAttachments: [{ renderedUrl: videoUrl, downloadUrl }],
      }
    );

    expect(result.markdown).toContain('[▶ Video]($1-example/_vGThNd8HNc3yfnk.mp4)');
    expect(result.markdown).not.toContain('[▶ Video]([▶ Video]');
    expect(result.images).toEqual([
      { url: downloadUrl, filename: '$1-example/_vGThNd8HNc3yfnk.mp4' },
    ]);
  });

  // Queuing an attachment the Markdown never points at leaves an orphan .mp4.
  it('does not queue a download when no video link token matched', () => {
    const result = postProcess(
      content(`![🎥 Video](${posterUrl})`),
      {
        includeMetadata: false,
        downloadImages: true,
        videoAttachments: [{ renderedUrl: videoUrl, downloadUrl }],
      }
    );

    expect(result.images).toEqual([
      { url: posterUrl, filename: 'example-123/poster.jpg' },
    ]);
  });

  it('renders, localizes, and queues an article VideoNode through the real seams', () => {
    const articleVideo = 'https://video.twimg.com/vid/article.mp4?tag=27';
    const articlePoster = 'https://pbs.twimg.com/media/article.jpg';
    const doc: Document = {
      version: 1,
      metadata: {
        type: 'article',
        sourceUrl: 'https://x.com/example/status/123',
        tweetId: '123',
        author: { name: 'Example', handle: 'example' },
        date: '2026-05-11T00:00:00.000Z',
        title: 'Example article',
      },
      body: {
        type: 'article',
        children: [{ type: 'video', posterUrl: articlePoster, sourceUrl: articleVideo }],
      },
    };
    const videoAttachments = collectMedia(doc)
      .filter(isDownloadableVideo)
      .map((media) => ({ renderedUrl: media.url, downloadUrl: media.url }));

    const result = postProcess(
      docToExtracted(doc, { includeVideoLinks: true }),
      { includeMetadata: false, downloadImages: true, videoAttachments },
    );

    expect(result.markdown).toContain('![🎥 Video](example-example-article/article.jpg)');
    expect(result.markdown).toContain('[▶ Video](example-example-article/article.mp4)');
    expect(result.images).toEqual([
      { url: articlePoster, filename: 'example-example-article/article.jpg' },
      { url: articleVideo, filename: 'example-example-article/article.mp4' },
    ]);
  });

  it('keeps slug filenames and Obsidian descriptions valid with a video link', () => {
    const result = postProcess(
      content(`# Example (@example)\n\nWatch this clip.\n\n[▶ Video](${videoUrl})`),
      {
        includeMetadata: true,
        downloadImages: true,
        obsidianFriendly: true,
        filenameTemplate: '{slug}',
        videoAttachments: [{ renderedUrl: videoUrl, downloadUrl }],
      }
    );

    expect(result.filename).toBe('watch-this-clip-video.md');
    expect(result.markdown).toContain('description: "Watch this clip. ▶ Video"');
    expect(result.markdown).toContain('[▶ Video](watch-this-clip-video/_vGThNd8HNc3yfnk.mp4)');
  });
});

describe('buildFilename() default behavior', () => {
  it('falls back to {handle}-{id}.md for tweets when no template is provided', () => {
    const data: ExtractedContent = {
      type: 'tweet',
      author: { name: 'Example', handle: '@example' },
      markdown: '# Example (@example)\n\nHi.',
      sourceUrl: 'https://x.com/example/status/123',
      date: '2026-05-11T00:00:00.000Z',
      tweetId: '123',
    };
    expect(buildFilename(data)).toBe('example-123.md');
  });

  it('keeps the legacy article filename when template is empty string', () => {
    const data: ExtractedContent = {
      type: 'article',
      author: { name: 'A', handle: '@a' },
      title: 'Hello, World!',
      markdown: '# Hello, World!\n\nBody.',
      sourceUrl: 'https://x.com/a/status/9',
      date: '2026-05-11T00:00:00.000Z',
      tweetId: '9',
    };
    expect(buildFilename(data, '')).toBe('a-hello-world.md');
  });
});

describe('applyFilenameTemplate()', () => {
  const sample: ExtractedContent = {
    type: 'thread',
    author: { name: 'Jane Doe', handle: '@janedoe' },
    markdown: '# Jane Doe (@janedoe)\n\nThe quick brown fox jumps over the lazy dog.',
    sourceUrl: 'https://x.com/janedoe/status/42',
    date: '2026-05-19T14:30:00.000Z',
    tweetId: '42',
  };

  it('substitutes the documented placeholders', () => {
    expect(applyFilenameTemplate('{date}-{handle}-{slug}', sample))
      .toBe('2026-05-19-janedoe-the-quick-brown-fox-jumps-over-the-lazy-dog.md');
  });

  it('supports {datetime}, {author}, {id}, {type}', () => {
    expect(applyFilenameTemplate('{datetime}_{author}_{type}_{id}', sample))
      .toBe('2026-05-19_1430_Jane Doe_thread_42.md');
  });

  it('strips filesystem-invalid characters from placeholder values', () => {
    const dirty: ExtractedContent = {
      ...sample,
      author: { name: 'A/B:C*D?E"F<G>H|I', handle: '@x' },
    };
    expect(applyFilenameTemplate('{author}-{id}', dirty)).toBe('ABCDEFGHI-42.md');
  });

  it('caps total length around 120 chars before the .md extension', () => {
    const long: ExtractedContent = {
      ...sample,
      markdown: 'x '.repeat(200),
    };
    const out = applyFilenameTemplate('{slug}', long);
    // slug itself is capped to 60, so this is naturally short — verify cap with
    // a literal long template instead.
    const literal = 'a'.repeat(200);
    const capped = applyFilenameTemplate(literal, long);
    expect(capped.length).toBeLessThanOrEqual(123); // 120 + '.md'
    expect(capped.endsWith('.md')).toBe(true);
    expect(out.endsWith('.md')).toBe(true);
  });

  it('ignores a trailing .md in the user-supplied template', () => {
    expect(applyFilenameTemplate('{handle}-{id}.md', sample))
      .toBe('janedoe-42.md');
  });

  it('returns empty string when the template renders to nothing', () => {
    expect(applyFilenameTemplate('   ', sample)).toBe('');
  });
});

describe('postProcess() frontmatter field filtering', () => {
  const data: ExtractedContent = {
    type: 'tweet',
    author: { name: 'Example', handle: '@example' },
    markdown: '# Example (@example)\n\nHi.',
    sourceUrl: 'https://x.com/example/status/123',
    date: '2026-05-11T00:00:00.000Z',
    tweetId: '123',
    metadata: { likes: 10, reposts: 2, views: 100 },
  };

  it('omits default-mode fields whose entry is false', () => {
    const result = postProcess(data, {
      includeMetadata: true,
      downloadImages: false,
      frontmatterFields: { author: false, handle: true, source: true, date: false, type: true, likes: false, reposts: true, views: true },
    });
    expect(result.markdown).not.toContain('author:');
    expect(result.markdown).not.toContain('\ndate:');
    expect(result.markdown).not.toContain('likes:');
    expect(result.markdown).toContain('handle: "@example"');
    expect(result.markdown).toContain('reposts: 2');
    expect(result.markdown).toContain('views: 100');
  });

  it('treats missing keys as enabled (forward compat for new fields)', () => {
    const result = postProcess(data, {
      includeMetadata: true,
      downloadImages: false,
      // Older saved map without the newly-added `views` key — it should still
      // be emitted rather than silently dropped.
      frontmatterFields: { author: true, handle: true },
    });
    expect(result.markdown).toContain('views: 100');
  });

  it('filters obsidian-mode fields independently', () => {
    const result = postProcess(data, {
      includeMetadata: true,
      downloadImages: false,
      obsidianFriendly: true,
      frontmatterFields: { title: false, tags: false, source: true, author: true, handle: true, published: true, created: true, type: true, description: true, author_name: true, likes: true, reposts: true, replies: true, bookmarks: true, views: true },
    });
    expect(result.markdown).not.toContain('title:');
    expect(result.markdown).not.toContain('tags:');
    expect(result.markdown).toContain('author: "[[@example]]"');
    expect(result.markdown).toContain('published: 2026-05-11');
  });
});

describe('applyTagsTemplate()', () => {
  const sample: ExtractedContent = {
    type: 'thread',
    author: { name: 'Jane Doe', handle: '@janedoe' },
    markdown: '# Jane Doe (@janedoe)\n\nThe quick brown fox.',
    sourceUrl: 'https://x.com/janedoe/status/42',
    date: '2026-05-19T14:30:00.000Z',
    tweetId: '42',
  };

  it('reproduces the legacy tags list via the default template', () => {
    expect(applyTagsTemplate(DEFAULT_TAGS_TEMPLATE, sample)).toEqual(['clippings', 'x', 'thread']);
  });

  it('parses comma-separated tags leniently (whitespace tolerated)', () => {
    expect(applyTagsTemplate(' clippings , x ,{type} ', sample)).toEqual(['clippings', 'x', 'thread']);
  });

  it('substitutes the documented placeholders', () => {
    expect(applyTagsTemplate('{handle}, {type}, daily-{date}', sample))
      .toEqual(['janedoe', 'thread', 'daily-2026-05-19']);
  });

  it('drops empty pieces from trailing or doubled commas', () => {
    expect(applyTagsTemplate(',clippings,,x,', sample)).toEqual(['clippings', 'x']);
  });

  it('drops a tag whose unknown placeholder cannot be resolved', () => {
    expect(applyTagsTemplate('clippings, {nope}, x', sample)).toEqual(['clippings', 'x']);
  });

  it('sanitizes tags to Obsidian-safe form', () => {
    expect(applyTagsTemplate('My Tag, A/B\\C, #already, , one--two', sample))
      .toEqual(['my-tag', 'abc', 'already', 'one-two']);
  });
});

describe('postProcess() obsidian tags template', () => {
  const data: ExtractedContent = {
    type: 'thread',
    author: { name: 'Example', handle: '@example' },
    markdown: '# Example (@example)\n\nHi.',
    sourceUrl: 'https://x.com/example/status/123',
    date: '2026-05-11T00:00:00.000Z',
    tweetId: '123',
  };

  it('emits the legacy tags line when no custom template is set', () => {
    const result = postProcess(data, {
      includeMetadata: true,
      downloadImages: false,
      obsidianFriendly: true,
    });
    expect(result.markdown).toContain('tags: [clippings, x, thread]');
  });

  it('emits the custom tags line when a template is set', () => {
    const result = postProcess(data, {
      includeMetadata: true,
      downloadImages: false,
      obsidianFriendly: true,
      obsidianTagsTemplate: '{handle}, social/x, {type}',
    });
    expect(result.markdown).toContain('tags: [example, socialx, thread]');
  });

  it('omits the tags line entirely when the template resolves to nothing', () => {
    const result = postProcess(data, {
      includeMetadata: true,
      downloadImages: false,
      obsidianFriendly: true,
      obsidianTagsTemplate: '{unknown}, {alsounknown}',
    });
    expect(result.markdown).not.toContain('tags:');
  });
});

describe('postProcess() filename template', () => {
  it('uses the template when provided via options', () => {
    const data: ExtractedContent = {
      type: 'tweet',
      author: { name: 'Example', handle: '@example' },
      markdown: '# Example (@example)\n\nHello world',
      sourceUrl: 'https://x.com/example/status/123',
      date: '2026-05-19T00:00:00.000Z',
      tweetId: '123',
    };
    const result = postProcess(data, {
      includeMetadata: false,
      downloadImages: false,
      filenameTemplate: '{date}-{handle}-{id}',
    });
    expect(result.filename).toBe('2026-05-19-example-123.md');
  });

  it('inserts inline stats correctly for single tweets vs threads', () => {
    const tweetData: ExtractedContent = {
      type: 'tweet',
      author: { name: 'Example', handle: '@example' },
      markdown: '# Example (@example)\n\nThis is a single tweet.\n\n---\n> Source: https://x.com/example/status/123',
      sourceUrl: 'https://x.com/example/status/123',
      date: '2026-05-11T00:00:00.000Z',
      tweetId: '123',
      metadata: { likes: 10, reposts: 2, replies: 0, bookmarks: 0, views: 100 },
    };

    const threadData: ExtractedContent = {
      type: 'thread',
      author: { name: 'Example', handle: '@example' },
      markdown: '# Example (@example)\n\nFirst tweet in thread.\n\n---\n\nSecond tweet in thread.\n\n---\n> Source: https://x.com/example/status/123',
      sourceUrl: 'https://x.com/example/status/123',
      date: '2026-05-11T00:00:00.000Z',
      tweetId: '123',
      metadata: { likes: 10, reposts: 2, replies: 0, bookmarks: 0, views: 100 },
    };

    // Single tweet: stats before the source footer
    const singleResult = postProcess(tweetData, {
      includeMetadata: false,
      downloadImages: false,
      inlineStats: true,
    });
    expect(singleResult.markdown).toContain('💬 0 · 🔁 2 · ❤️ 10 · 🔖 0 · 👁 100\n\n---\n> Source:');

    // Thread: stats after the first tweet (before the first separator)
    const threadResult = postProcess(threadData, {
      includeMetadata: false,
      downloadImages: false,
      inlineStats: true,
    });
    expect(threadResult.markdown).toContain('First tweet in thread.');
    expect(threadResult.markdown).toContain('💬 0 · 🔁 2 · ❤️ 10 · 🔖 0 · 👁 100\n---\n\nSecond tweet in thread.');
  });
});
