import { describe, expect, it } from 'vitest';
import { docToExtracted } from '../src/shared/extracted-content';
import { applyTagsTemplate, postProcess } from '../src/shared/post-process';
import type { Document } from '../src/ast/types';

// The AST stores handles bare (stripHandlePrefix on the DOM side, `screen_name`
// on the GraphQL side); ExtractedContent — and so the frontmatter, the Obsidian
// wikilink, the synthesized title and the CSV column — carries the `@`. Issue
// #124: the two acquisition engines used to disagree here.
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

describe('docToExtracted()', () => {
  it('re-adds the @ the AST strips from the handle', () => {
    expect(docToExtracted(doc).author).toEqual({ name: 'Notion', handle: '@NotionHQ' });
  });

  it('writes the @ form into both frontmatter schemas', () => {
    const plain = postProcess(docToExtracted(doc), { includeMetadata: true, downloadImages: false });
    expect(plain.markdown).toContain('handle: "@NotionHQ"');

    const obsidian = postProcess(docToExtracted(doc), {
      includeMetadata: true,
      downloadImages: false,
      obsidianFriendly: true,
    });
    expect(obsidian.markdown).toContain('handle: "@NotionHQ"');
    expect(obsidian.markdown).toContain('author: "[[@NotionHQ]]"');
    expect(obsidian.markdown).toContain('title: "Post by @NotionHQ on X"');
  });

  it('keeps the @ out of the filename and the tag template', () => {
    expect(postProcess(docToExtracted(doc), { includeMetadata: true, downloadImages: false }).filename)
      .toBe('NotionHQ-123.md');
    // Tags are slugified, so the @ is gone here either way — asserted so the
    // decision in #124 stays visibly scoped to the fields that do carry it.
    expect(applyTagsTemplate('{handle}', docToExtracted(doc))).toEqual(['notionhq']);
  });
});
