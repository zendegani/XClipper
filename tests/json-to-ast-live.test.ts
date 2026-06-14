import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { jsonToAst } from '../src/graphql/json-to-ast';
import { parseTimelinePage } from '../src/graphql/timeline';
import { renderMarkdown } from '../src/ast/render-markdown';

// Exercises jsonToAst against a REAL captured X GraphQL Bookmarks response.
// The capture holds the user's own bookmarks, so it is git-ignored (under
// _local/) and absent in CI — this suite then skips with a warning, exactly
// like the DOM extractor's gitignored HTML fixtures. A green CI run does NOT
// mean this ran. See docs/capturing-graphql-fixtures.md.

const CANDIDATES = [
  '_local/bookmarks-response.json',
  '_local/fast/bookmarks-response.json',
  'tests/fixtures/graphql/bookmarks-response.json',
];
const path = CANDIDATES.find((p) => existsSync(p));

// Pull the tweet_results.result objects out of a bookmarks timeline payload.
function tweetResults(raw: unknown): unknown[] {
  const j = raw as {
    data?: { bookmark_timeline_v2?: { timeline?: { instructions?: { type?: string; entries?: unknown[] }[] } } };
  };
  const instructions = j.data?.bookmark_timeline_v2?.timeline?.instructions ?? [];
  const entries = (instructions.find((i) => i.type === 'TimelineAddEntries') ?? instructions[0])?.entries ?? [];
  return entries
    .map((e) => (e as { content?: { itemContent?: { tweet_results?: { result?: unknown } } } }).content?.itemContent?.tweet_results?.result)
    .filter((r): r is unknown => r != null);
}

describe.skipIf(!path)('jsonToAst — real captured bookmarks response', () => {
  const raw = JSON.parse(readFileSync(path as string, 'utf8'));
  const results = tweetResults(raw);

  it('finds tweet entries in the capture', () => {
    expect(results.length).toBeGreaterThan(0);
  });

  it('parseTimelinePage agrees with the entries and yields a cursor', () => {
    const pageData = parseTimelinePage(raw);
    expect(pageData.tweetResults.length).toBe(results.length);
    expect(pageData.bottomCursor).toBeTruthy();
    expect(pageData.done).toBe(false);
  });

  it('maps every entry to a renderable Document with author + id', () => {
    for (const result of results) {
      const doc = jsonToAst(result);
      // type is 'tweet' for tweets, 'article' for X long-form articles.
      expect(['tweet', 'article']).toContain(doc.metadata.type);
      expect(doc.body.type).toBe(doc.metadata.type);
      expect(doc.metadata.tweetId).toMatch(/^\d+$/);
      expect(doc.metadata.author.handle.length).toBeGreaterThan(0);
      // The whole point of ADR 0003: a mapped Document renders unchanged.
      expect(() => renderMarkdown(doc)).not.toThrow();
    }
  });

  it('labels X long-form articles as type "article"', () => {
    const hasArticle = (r: unknown): boolean =>
      !!(r as { article?: { article_results?: { result?: unknown } } }).article?.article_results?.result;
    for (const result of results.filter(hasArticle)) {
      expect(jsonToAst(result).metadata.type).toBe('article');
    }
  });
});

if (!path) {
  // Surface the skip the way extractor.test.ts does, so it isn't silent.
  console.warn(
    '[json-to-ast-live] no captured GraphQL response found (looked in _local/) — skipping real-data validation'
  );
}
