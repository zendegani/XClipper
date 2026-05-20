import { describe, expect, it } from 'vitest';
import { postProcess, buildFilename, applyFilenameTemplate } from '../src/shared/post-process';
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
});
