import { describe, it, expect, beforeEach } from 'vitest';
import { extract } from '../src/content/content';

// Builds a minimal two-tweet thread (both by @alice) in the global jsdom
// document and points window.location at the second tweet's permalink. This
// lets us exercise the singleTweet branch of extractTweetAsync without a
// full page fixture.
function buildThread(): void {
  document.body.innerHTML = `
    <article role="article">
      <div data-testid="User-Name">
        <a href="/alice"><span>Alice</span></a>
        <a href="/alice"><span>@alice</span></a>
      </div>
      <a href="/alice/status/111"><time datetime="2026-05-01T00:00:00.000Z">May 1</time></a>
      <div data-testid="tweetText"><span>First tweet in thread</span></div>
    </article>
    <article role="article">
      <div data-testid="User-Name">
        <a href="/alice"><span>Alice</span></a>
        <a href="/alice"><span>@alice</span></a>
      </div>
      <a href="/alice/status/222"><time datetime="2026-05-01T00:01:00.000Z">May 1</time></a>
      <div data-testid="tweetText"><span>Second tweet in thread</span></div>
    </article>
  `;
  const url = 'https://x.com/alice/status/222';
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname: '/alice/status/222', href: url, hash: '' },
    writable: true,
    configurable: true,
  });
}

describe('singleTweet extraction', () => {
  beforeEach(buildThread);

  it('captures only the focused tweet when singleTweet is set', async () => {
    const res = await extract({ singleTweet: true });
    expect(res.success).toBe(true);
    expect(res.data?.type).toBe('tweet');
    expect(res.data?.markdown).toContain('Second tweet in thread');
    expect(res.data?.markdown).not.toContain('First tweet in thread');
  });

  it('captures the whole thread by default', async () => {
    const res = await extract({ singleTweet: false });
    expect(res.success).toBe(true);
    expect(res.data?.type).toBe('thread');
    expect(res.data?.markdown).toContain('First tweet in thread');
    expect(res.data?.markdown).toContain('Second tweet in thread');
  });
});
