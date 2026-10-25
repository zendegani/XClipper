import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { extract } from '../src/content/content';
import { truncatedTweets } from '../src/ast/full-text';
import { renderPdfHtml } from '../src/ast/render-pdf-html';
import type { Document, TweetNode } from '../src/ast/types';

// Issue #184: on a permalink X previews every post but the requested one and
// puts a "Show more" button right after its text, as captured from a live
// thread. Here @bob's long post is the one @alice's requested reply answers.
function buildReply(): void {
  document.body.innerHTML = `
    <article role="article">
      <div data-testid="User-Name">
        <a href="/bob"><span>Bob</span></a>
        <a href="/bob"><span>@bob</span></a>
      </div>
      <a href="/bob/status/111"><time datetime="2026-05-01T00:00:00.000Z">May 1</time></a>
      <div>
        <div data-testid="tweetText"><span>A long post that X cuts off right in the</span></div>
        <button role="button" data-testid="tweet-text-show-more-link" type="button"><span>Show more</span></button>
      </div>
    </article>
    <article role="article">
      <div data-testid="User-Name">
        <a href="/alice"><span>Alice</span></a>
        <a href="/alice"><span>@alice</span></a>
      </div>
      <a href="/alice/status/222"><time datetime="2026-05-01T00:01:00.000Z">May 1</time></a>
      <div><div data-testid="tweetText"><span>Agreed</span></div></div>
    </article>
  `;
  const url = 'https://x.com/alice/status/222';
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname: '/alice/status/222', href: url, hash: '' },
    writable: true,
    configurable: true,
  });
}

const runtime = (globalThis as unknown as { chrome: { runtime: { sendMessage: unknown } } }).chrome.runtime;
const originalSendMessage = runtime.sendMessage;

function answerFullText(texts: [string, TweetNode['text']][]): ReturnType<typeof vi.fn> {
  const send = vi.fn((_msg: unknown, cb: (r: unknown) => void) => cb({ texts }));
  runtime.sendMessage = send;
  return send;
}

describe('posts X cut off at "Show more"', () => {
  beforeEach(buildReply);
  afterEach(() => {
    runtime.sendMessage = originalSendMessage;
  });

  it('marks the cut-off post and ends its text with a link to it', async () => {
    const res = await extract({ singleTweet: true, fullText: false });
    const doc = res.data!.body!;
    expect(doc.context?.[0].truncated).toBe(true);
    expect((doc.body as TweetNode).truncated).toBeUndefined();
    expect(res.data!.markdown).toContain(
      'cuts off right in the… [Show more](https://x.com/bob/status/111)'
    );
  });

  it('fills in the full text the background found and drops the link', async () => {
    const send = answerFullText([['111', [{ type: 'text', value: 'A long post that X cuts off right in the middle.' }]]]);
    const res = await extract({ singleTweet: true });
    expect(send.mock.calls[0][0]).toEqual({
      action: 'RESOLVE_FULL_TEXT',
      tweetId: '222',
      posts: [{ tweetId: '111', handle: 'bob' }],
    });
    expect(res.data!.body!.context?.[0].truncated).toBeUndefined();
    expect(res.data!.markdown).toContain('cuts off right in the middle.');
    expect(res.data!.markdown).not.toContain('Show more');
  });

  it('keeps the link when the background found nothing', async () => {
    answerFullText([]);
    const res = await extract({ singleTweet: true });
    expect(res.data!.markdown).toContain('[Show more](https://x.com/bob/status/111)');
  });
});

describe('truncatedTweets', () => {
  const post = (tweetId: string, extra: Partial<TweetNode> = {}): TweetNode => ({
    type: 'tweet',
    author: { name: 'A', handle: 'a' },
    date: '',
    tweetId,
    text: [{ type: 'text', value: 'x' }],
    media: [],
    ...extra,
  });

  it('finds cut-off posts in the context, quotes, and article embeds', () => {
    const doc: Document = {
      version: 1,
      metadata: { type: 'article', sourceUrl: '', tweetId: '1', author: { name: 'A', handle: 'a' }, date: '' },
      context: [post('2', { truncated: true })],
      body: {
        type: 'article',
        children: [
          post('3', { quotedTweet: post('4', { truncated: true }) }),
          { type: 'blockquote', children: [post('5', { truncated: true })] },
        ],
      },
    };
    expect(truncatedTweets(doc).map((t) => t.tweetId)).toEqual(['2', '4', '5']);
  });

  it('marks a cut-off post in the PDF too', () => {
    const doc: Document = {
      version: 1,
      metadata: { type: 'tweet', sourceUrl: '', tweetId: '9', author: { name: 'A', handle: 'a' }, date: '' },
      body: post('9', { truncated: true }),
    };
    expect(renderPdfHtml(doc)).toContain('x… <a href="https://x.com/a/status/9">Show more</a>');
  });
});
