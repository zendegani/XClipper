import { describe, it, expect } from 'vitest';
import { buildFormatExport, buildCsvRow, markdownToPlainText } from '../src/shared/export-formats';
import type { ExtractedContent } from '../src/types/messages';
import type { Document } from '../src/ast/types';

const doc: Document = {
  version: 1,
  metadata: {
    type: 'tweet',
    sourceUrl: 'https://x.com/jane/status/123',
    tweetId: '123',
    author: { name: 'Jane Doe', handle: '@jane' },
    date: '2026-01-02T10:00:00.000Z',
    engagement: { likes: 5, reposts: 2 },
  },
  body: {
    type: 'tweet',
    author: { name: 'Jane Doe', handle: '@jane' },
    date: '2026-01-02T10:00:00.000Z',
    tweetId: '123',
    text: [{ type: 'text', value: 'Hello, world' }],
    media: [],
  },
};

const data: ExtractedContent = {
  type: 'tweet',
  author: { name: 'Jane Doe', handle: '@jane' },
  markdown:
    '# Jane Doe (@jane)\n\nHello **bold** and a [link](https://example.com)\n\n' +
    '![pic](https://pbs.twimg.com/a.jpg)\n\n---\n\n> Source: https://x.com/jane/status/123\n> Date: 2026-01-02',
  sourceUrl: 'https://x.com/jane/status/123',
  date: '2026-01-02T10:00:00.000Z',
  tweetId: '123',
  metadata: { likes: 5, reposts: 2 },
  body: doc,
};

describe('markdownToPlainText', () => {
  it('strips markup but keeps link URLs', () => {
    const txt = markdownToPlainText(data.markdown);
    expect(txt).toContain('Hello bold and a link (https://example.com)');
    expect(txt).toContain('pic: https://pbs.twimg.com/a.jpg');
    expect(txt).not.toContain('**');
    expect(txt).not.toContain('# Jane');
    expect(txt).not.toMatch(/^>/m);
    expect(txt.endsWith('\n')).toBe(true);
  });
});

describe('buildCsvRow', () => {
  it('emits the default field set in CSV column order + a row', () => {
    const csv = buildCsvRow(data, { obsidianFriendly: false });
    const [header, row] = csv.trimEnd().split('\n');
    expect(header).toBe('date,author,handle,type,likes,reposts,replies,bookmarks,views,source,text');
    const cols = row.split(',');
    expect(cols[1]).toBe('Jane Doe'); // author
    expect(cols[2]).toBe('@jane'); // handle
    expect(cols[4]).toBe('5'); // likes
    expect(cols[5]).toBe('2'); // reposts
    expect(cols[6]).toBe(''); // replies absent
    // The trailing `text` column carries the post body only — not the author
    // header or the Source/Date footer (those already have their own columns).
    expect(row.endsWith('"Hello, world"')).toBe(true);
    expect(csv).not.toContain('Source:');
    expect(csv).not.toContain('Date:');
  });

  it('honors per-field toggles', () => {
    const csv = buildCsvRow(data, {
      obsidianFriendly: false,
      frontmatterFields: { likes: false, reposts: false, replies: false, bookmarks: false, views: false },
    });
    expect(csv.split('\n')[0]).toBe('date,author,handle,type,source,text');
  });

  it('uses the handle for author in the Obsidian field set', () => {
    const csv = buildCsvRow(data, { obsidianFriendly: true });
    const [header, row] = csv.trimEnd().split('\n');
    const idx = header.split(',').indexOf('author');
    expect(row.split(',')[idx]).toBe('@jane');
  });

  it('quotes values containing commas', () => {
    const withComma: ExtractedContent = { ...data, author: { name: 'Doe, Jane', handle: '@jane' } };
    const csv = buildCsvRow(withComma, { obsidianFriendly: false });
    expect(csv).toContain('"Doe, Jane"');
  });
});

describe('buildFormatExport', () => {
  it('html reuses the standalone renderer', () => {
    const out = buildFormatExport('html', data);
    expect(out.ext).toBe('html');
    expect(out.mime).toBe('text/html');
    expect(out.content).toContain('<!doctype html>');
  });

  it('json serializes the AST document', () => {
    const out = buildFormatExport('json', data);
    expect(out.ext).toBe('json');
    const parsed = JSON.parse(out.content);
    expect(parsed.version).toBe(1);
    expect(parsed.metadata.type).toBe('tweet');
  });

  it('txt and csv carry the right mime/ext', () => {
    expect(buildFormatExport('txt', data).mime).toBe('text/plain');
    expect(buildFormatExport('csv', data).ext).toBe('csv');
  });
});
