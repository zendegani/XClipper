import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadRequest, DownloadResponse } from '../src/types/messages';

// The XClipper button on a post and the right-click "Download tweet as …"
// items download a file without the popup. They must show the background's
// answer, not "Downloaded!" for every request.

const runtime = (globalThis as unknown as { chrome: { runtime: Record<string, unknown> } }).chrome
  .runtime;

let answer: DownloadResponse;
let videoUrls: [string, string][] = [];
const sendMessage = vi.fn((msg: { action: string }, cb?: (r: unknown) => void) => {
  if (msg.action === 'DOWNLOAD_MD') cb?.(answer);
  else if (msg.action === 'RESOLVE_VIDEO_URLS') cb?.({ urls: videoUrls });
  else cb?.(undefined);
});
runtime.sendMessage = sendMessage;

// Keep the content script's XCLIPPER_AUTOEXTRACT listener, to call it below.
type Listener = (msg: unknown, sender: unknown, respond: (r: unknown) => void) => boolean;
const listeners: Listener[] = [];
runtime.onMessage = { addListener: (fn: Listener) => listeners.push(fn) };

// The saved settings that loadSettings reads.
let savedSettings: Record<string, unknown> = {};
(globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local.get = (
  _keys: unknown,
  cb: (r: Record<string, unknown>) => void
) => cb({ xclipper_settings: savedSettings });

await import('../src/content/content');

const POSTER = 'https://pbs.twimg.com/amplify_video_thumb/333/img/Poster.jpg';
const MP4 = 'https://video.twimg.com/amplify_video/333/vid/avc1/1280x720/Clip.mp4';

function buildTweet(media = ''): void {
  document.body.innerHTML = `
    <article role="article">
      <div data-testid="User-Name">
        <a href="/alice"><span>Alice</span></a>
        <a href="/alice"><span>@alice</span></a>
      </div>
      <a href="/alice/status/222"><time datetime="2026-05-01T00:01:00.000Z">May 1</time></a>
      <div data-testid="tweetText"><span>A tweet</span></div>
      ${media}
    </article>
  `;
  const url = 'https://x.com/alice/status/222';
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname: '/alice/status/222', href: url, hash: '' },
    writable: true,
    configurable: true,
  });
}

// tests/setup.ts makes chrome.i18n.getMessage return the key, so the success
// toast reads 'downloaded'.
function toastText(): string {
  return [...document.body.children]
    .filter((el) => el.tagName === 'DIV')
    .map((el) => el.textContent)
    .join('|');
}

function autoExtract(subAction: string): Promise<unknown> {
  return new Promise((resolve) => {
    for (const fn of listeners) fn({ action: 'XCLIPPER_AUTOEXTRACT', subAction }, {}, resolve);
  });
}

describe('in-page download', () => {
  beforeEach(() => {
    buildTweet();
    sendMessage.mockClear();
    savedSettings = {};
    videoUrls = [];
  });

  for (const subAction of ['download', 'txt']) {
    it(`shows the error when the ${subAction} download fails`, async () => {
      answer = { success: false, error: 'Disk full' };
      await autoExtract(subAction);
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DOWNLOAD_MD' }),
        expect.any(Function)
      );
      expect(toastText()).toBe('Disk full');
    });

    it(`shows the success toast when the ${subAction} download works`, async () => {
      answer = { success: true, downloadId: 1 };
      await autoExtract(subAction);
      expect(toastText()).toBe('downloaded');
    });
  }

  describe('with Save locally set to Media', () => {
    const VIDEO = `
      <div data-testid="tweetPhoto">
        <div data-testid="videoPlayer"><video poster="${POSTER}"></video></div>
      </div>`;

    beforeEach(() => {
      buildTweet(VIDEO);
      savedSettings = { downloadImages: true, saveVideos: true };
      answer = { success: true, downloadId: 1 };
    });

    function downloadRequest(): DownloadRequest {
      const call = sendMessage.mock.calls.find(([msg]) => msg.action === 'DOWNLOAD_MD');
      return call![0] as unknown as DownloadRequest;
    }

    it('saves the video next to the Markdown, as the popup does', async () => {
      videoUrls = [['/amplify_video_thumb/333/img/poster.jpg', MP4]];
      await autoExtract('download');

      expect(sendMessage).toHaveBeenCalledWith(
        { action: 'RESOLVE_VIDEO_URLS', tweetId: '222' },
        expect.any(Function)
      );
      const req = downloadRequest();
      expect(req.images).toContainEqual({ url: MP4, filename: expect.stringMatching(/\/Clip\.mp4$/) });
      expect(req.content).toMatch(/\[▶ Video\]\([^)]*\/Clip\.mp4\)/);
      expect(toastText()).toBe('downloaded');
    });

    it('keeps the video as a link and says so when it cannot resolve it', async () => {
      await autoExtract('download');

      const req = downloadRequest();
      expect(req.images?.some((i) => i.url.endsWith('.mp4'))).toBeFalsy();
      expect(toastText()).toBe('video_unresolved');
    });

    it('does not ask for the video when Save locally is Images', async () => {
      savedSettings = { downloadImages: true, saveVideos: false };
      await autoExtract('download');

      expect(sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RESOLVE_VIDEO_URLS' }),
        expect.any(Function)
      );
    });
  });
});
