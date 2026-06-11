import { describe, it, expect } from 'vitest';
import type { Document } from '../src/ast/types';
import { renderDigest } from '../src/ast/render-digest';

function tweetDoc(handle: string, text: string, id: string): Document {
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
      media: [],
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
});
