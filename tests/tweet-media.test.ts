import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractTweetAsync } from '../src/content/tweet';

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

describe('tweet media extraction', () => {
  it('does not emit a video poster thumbnail as both an image and a video', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    setStatusUrl('/example/status/123');

    const poster = 'https://pbs.twimg.com/amplify_video_thumb/123/img/poster.jpg';
    setBody(`
      <main>
        <article role="article">
          <div data-testid="User-Name">
            <a href="/example">Example</a>
            <a href="/example">@example</a>
          </div>
          <a href="/example/status/123"><time datetime="2026-05-11T12:00:00.000Z"></time></a>
          <div data-testid="tweetText">hello video</div>
          <div data-testid="tweetPhoto">
            <img src="https://pbs.twimg.com/media/photo?format=jpg&name=small" />
          </div>
          <div data-testid="tweetPhoto">
            <img src="${poster}" />
            <video poster="${poster}"></video>
          </div>
        </article>
      </main>
    `);

    const extraction = extractTweetAsync();
    await vi.advanceTimersByTimeAsync(1_250);
    const result = await extraction;

    expect(result.markdown).toContain(
      '![Image](https://pbs.twimg.com/media/photo?format=jpg&name=large)'
    );
    expect(result.markdown).not.toContain(`![Image](${poster})`);
    expect(result.markdown).toContain(`[🎥 Video](${poster})`);
  });
});
