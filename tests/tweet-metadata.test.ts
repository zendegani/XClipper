import { afterEach, describe, expect, it, vi } from 'vitest';
import { extract } from '../src/content/content';
import { extractEngagementMetadata } from '../src/content/tweet';

function setStatusUrl(path: string): void {
  window.history.pushState(null, '', path);
}

function setBody(html: string): void {
  document.body.innerHTML = html;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('tweet metadata extraction', () => {
  it('parses abbreviated X engagement counts', () => {
    setBody(`
      <article role="article">
        <div role="group" aria-label="24 replies, 32 reposts, 797 likes, 1.5K bookmarks, 122.4K views"></div>
      </article>
    `);

    expect(extractEngagementMetadata(document.body)).toEqual({
      replies: 24,
      reposts: 32,
      likes: 797,
      bookmarks: 1500,
      views: 122400,
    });
  });

  it('uses the target status article for metadata when another article is mounted first', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    setStatusUrl('/david__booth/status/2051021016361836837');

    setBody(`
      <main>
        <article role="article">
          <div data-testid="User-Name">
            <a href="/reply">Reply Person</a>
            <a href="/reply">@reply</a>
          </div>
          <a href="/reply/status/999"><time datetime="2026-05-11T12:00:00.000Z"></time></a>
          <div data-testid="tweetText">mounted before the target</div>
          <div role="group" aria-label="1 reply, 14 likes, 11 bookmarks, 9,231 views"></div>
        </article>
        <article role="article">
          <div data-testid="User-Name">
            <a href="/david__booth">David Booth</a>
            <a href="/david__booth">@david__booth</a>
          </div>
          <a href="/david__booth/status/2051021016361836837"><time datetime="2026-05-03T19:28:11.000Z"></time></a>
          <div data-testid="tweetText">root thread tweet</div>
          <div role="group" aria-label="24 replies, 32 reposts, 797 likes, 1.5K bookmarks, 122.4K views"></div>
        </article>
      </main>
    `);

    const extraction = extract({ includeMetadata: true });
    await vi.advanceTimersByTimeAsync(3_000);
    const response = await extraction;

    expect(response.success).toBe(true);
    if (!response.success || !response.data) return;

    expect(response.data.metadata).toEqual({
      replies: 24,
      reposts: 32,
      likes: 797,
      bookmarks: 1500,
      views: 122400,
    });
  });
});
