import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadResponse } from '../src/types/messages';

// The XClipper button on a post and the right-click "Download tweet as …"
// items download a file without the popup. They must show the background's
// answer, not "Downloaded!" for every request.

const runtime = (globalThis as unknown as { chrome: { runtime: Record<string, unknown> } }).chrome
  .runtime;

let answer: DownloadResponse;
const sendMessage = vi.fn((msg: { action: string }, cb?: (r: unknown) => void) => {
  cb?.(msg.action === 'DOWNLOAD_MD' ? answer : undefined);
});
runtime.sendMessage = sendMessage;

// Keep the content script's XCLIPPER_AUTOEXTRACT listener, to call it below.
type Listener = (msg: unknown, sender: unknown, respond: (r: unknown) => void) => boolean;
const listeners: Listener[] = [];
runtime.onMessage = { addListener: (fn: Listener) => listeners.push(fn) };

await import('../src/content/content');

function buildTweet(): void {
  document.body.innerHTML = `
    <article role="article">
      <div data-testid="User-Name">
        <a href="/alice"><span>Alice</span></a>
        <a href="/alice"><span>@alice</span></a>
      </div>
      <a href="/alice/status/222"><time datetime="2026-05-01T00:01:00.000Z">May 1</time></a>
      <div data-testid="tweetText"><span>A tweet</span></div>
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
});
