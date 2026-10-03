import { describe, expect, it } from 'vitest';
import { zipEntryFromStored } from '../src/background/batch-sink';
import { buildFormatExport } from '../src/shared/export-formats';
import { docToExtracted } from '../src/shared/extracted-content';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { Document } from '../src/ast/types';

// Regression for #135: every Markdown export path must pass the user's
// custom tags template to postProcess, not just the popup buttons.

const doc: Document = {
  version: 1,
  metadata: {
    type: 'tweet',
    sourceUrl: 'https://x.com/NotionHQ/status/123',
    tweetId: '123',
    author: { name: 'Notion', handle: 'NotionHQ' },
    date: '2026-05-11T00:00:00.000Z',
  },
  body: { type: 'thread', tweets: [] },
};

const settings = { ...DEFAULT_SETTINGS, obsidianFriendly: true, obsidianTagsTemplate: 'reading, {handle}' };

describe('custom Obsidian tags template', () => {
  it('CSV export uses it (control)', () => {
    const csv = buildFormatExport('csv', docToExtracted(doc), {
      obsidianFriendly: true,
      obsidianTagsTemplate: settings.obsidianTagsTemplate,
    });
    expect(csv.content).toContain('reading');
  });

  it('batch Markdown (zip path) uses it', () => {
    const entry = zipEntryFromStored({ url: doc.metadata.sourceUrl, filename: 'a.md', doc }, 'md', settings);
    expect(entry.content).toContain('tags: [reading, notionhq]');
  });
});
