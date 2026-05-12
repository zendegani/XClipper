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

function threadContent(overrides: Partial<ExtractedContent> = {}): ExtractedContent {
  return {
    type: 'thread',
    author: { name: 'Example', handle: '@example' },
    markdown: '# Example (@example)\n\nfirst\n\n---\n\n> Source: https://x.com/example/status/123\n> Date: 2026-05-11T00:00:00.000Z',
    sourceUrl: 'https://x.com/example/status/123',
    date: '2026-05-11T00:00:00.000Z',
    tweetId: '123',
    thread: {
      complete: true,
      stopReason: 'reply_boundary',
      collectedCount: 3,
      failedCount: 0,
      steps: 4,
      durationMs: 2200,
    },
    ...overrides,
  };
}

describe('postProcess() thread diagnostics', () => {
  it('emits thread diagnostics in YAML metadata for complete threads', () => {
    const result = postProcess(threadContent(), {
      includeMetadata: true,
      downloadImages: false,
    });

    expect(result.markdown).toContain('type: thread');
    expect(result.markdown).toContain('thread_complete: true');
    expect(result.markdown).toContain('thread_stop_reason: "reply_boundary"');
    expect(result.markdown).toContain('thread_collected_count: 3');
    expect(result.markdown).toContain('thread_failed_count: 0');
    expect(result.markdown).toContain('thread_steps: 4');
    expect(result.markdown).toContain('thread_duration_ms: 2200');
    expect(result.markdown).not.toContain('tweet2md: thread extraction may be incomplete');
  });

  it('adds a quiet comment for incomplete threads', () => {
    const result = postProcess(
      threadContent({
        thread: {
          complete: false,
          stopReason: 'max_steps',
          collectedCount: 12,
          failedCount: 1,
          steps: 60,
          durationMs: 24750,
        },
      }),
      { includeMetadata: true, downloadImages: false }
    );

    expect(result.markdown).toContain('thread_complete: false');
    expect(result.markdown).toContain('thread_stop_reason: "max_steps"');
    expect(result.markdown).toContain(
      '<!-- tweet2md: thread extraction may be incomplete; tweet_id=123; stop_reason=max_steps; collected=12; failed=1; steps=60; duration_ms=24750 -->'
    );
  });

  it('adds the incomplete comment even when YAML metadata is disabled', () => {
    const result = postProcess(
      threadContent({
        thread: {
          complete: false,
          stopReason: 'max_duration',
          collectedCount: 2,
          failedCount: 0,
          steps: 8,
          durationMs: 25000,
        },
      }),
      { includeMetadata: false, downloadImages: false }
    );

    expect(result.markdown).not.toContain('thread_complete:');
    expect(result.markdown).toContain('tweet2md: thread extraction may be incomplete');
  });

  it('flags a degraded single-post collection in frontmatter', () => {
    const result = postProcess(
      threadContent({
        thread: {
          complete: false,
          stopReason: 'max_duration',
          collectedCount: 1,
          failedCount: 0,
          steps: 4,
          durationMs: 25000,
        },
      }),
      { includeMetadata: true, downloadImages: false }
    );

    expect(result.markdown).toContain('thread_complete: false');
    expect(result.markdown).toContain('thread_degraded: true');
    expect(result.markdown).toContain('tweet2md: thread extraction may be incomplete');
  });

  it('omits thread_degraded for multi-post incomplete collections', () => {
    const result = postProcess(
      threadContent({
        thread: {
          complete: false,
          stopReason: 'max_steps',
          collectedCount: 12,
          failedCount: 0,
          steps: 60,
          durationMs: 24000,
        },
      }),
      { includeMetadata: true, downloadImages: false }
    );

    expect(result.markdown).not.toContain('thread_degraded');
  });

  it('preserves inline stats and the incomplete-thread comment together', () => {
    const result = postProcess(
      threadContent({
        metadata: { likes: 1234, replies: 5, reposts: 10, views: 50_000 },
        thread: {
          complete: false,
          stopReason: 'max_steps',
          collectedCount: 8,
          failedCount: 1,
          steps: 60,
          durationMs: 24500,
        },
      }),
      { includeMetadata: false, downloadImages: false, inlineStats: true }
    );

    expect(result.markdown).toContain('💬 5');
    expect(result.markdown).toContain('❤️ 1.2K');
    expect(result.markdown).toContain('tweet2md: thread extraction may be incomplete');
    // Both blocks must land before the source footer, not after.
    const sourceIdx = result.markdown.indexOf('> Source:');
    const statsIdx = result.markdown.indexOf('💬');
    const commentIdx = result.markdown.indexOf('tweet2md:');
    expect(statsIdx).toBeGreaterThan(-1);
    expect(commentIdx).toBeGreaterThan(-1);
    expect(statsIdx).toBeLessThan(sourceIdx);
    expect(commentIdx).toBeLessThan(sourceIdx);
  });
});
