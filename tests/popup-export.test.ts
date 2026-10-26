import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SINGLE_EXPORT_PORT,
  type DownloadRequest,
  type DownloadResponse,
  type SingleExportRequest,
  type SingleExportState,
} from '../src/types/messages';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings';

// A popup export must not be lost when the popup closes before it ends (issue
// #191). While the popup is open, it gets the post and does the last step
// itself. When it closes first, the content script does that step and shows a
// toast. A popup opened again in the meantime sees that the export continues.

const chromeStub = (globalThis as unknown as { chrome: { runtime: Record<string, unknown> } }).chrome;

// The background's answer to DOWNLOAD_MD, given when `downloadHeld` resolves.
let downloadAnswer: DownloadResponse = { success: true, downloadId: 1 };
let downloadHeld: Promise<void> = Promise.resolve();
const sendMessage = vi.fn((msg: { action: string }, cb?: (r: unknown) => void) => {
  if (msg.action === 'DOWNLOAD_MD') void downloadHeld.then(() => cb?.(downloadAnswer));
  else cb?.(undefined);
});
chromeStub.runtime.sendMessage = sendMessage;

type PortListener = (msg: unknown) => void;
type ConnectListener = (port: unknown) => void;
const connectListeners: ConnectListener[] = [];
chromeStub.runtime.onConnect = { addListener: (fn: ConnectListener) => connectListeners.push(fn) };

await import('../src/content/content');

// One popup's port, seen from the popup side.
function openPopup(name = SINGLE_EXPORT_PORT) {
  const onMessage: PortListener[] = [];
  const onDisconnect: (() => void)[] = [];
  const received: unknown[] = [];
  const waiters: { match: (m: unknown) => boolean; resolve: (m: unknown) => void }[] = [];
  const contentSide = {
    name,
    postMessage: (msg: unknown) => {
      received.push(msg);
      for (const w of waiters.filter((w) => w.match(msg))) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    },
    onMessage: { addListener: (fn: PortListener) => onMessage.push(fn) },
    onDisconnect: { addListener: (fn: () => void) => onDisconnect.push(fn) },
  };
  for (const fn of connectListeners) fn(contentSide);
  return {
    received,
    send: (msg: unknown) => onMessage.forEach((fn) => fn(msg)),
    close: () => onDisconnect.forEach((fn) => fn()),
    next: <T>(action: string) =>
      new Promise<T>((resolve) => {
        const match = (m: unknown) => (m as { action: string }).action === action;
        const seen = received.find(match);
        if (seen) resolve(seen as T);
        else waiters.push({ match, resolve: resolve as (m: unknown) => void });
      }),
  };
}

function request(
  target: SingleExportRequest['target'],
  format: SingleExportRequest['format'] = 'md',
  settings: Partial<Settings> = {}
): SingleExportRequest {
  return { action: 'SINGLE_EXPORT', target, format, settings: { ...DEFAULT_SETTINGS, ...settings } };
}

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
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname: '/alice/status/222', href: 'https://x.com/alice/status/222', hash: '' },
    writable: true,
    configurable: true,
  });
}

function toastText(): string {
  return [...document.body.children]
    .filter((el) => el.tagName === 'DIV')
    .map((el) => el.textContent)
    .join('|');
}

function downloads(): DownloadRequest[] {
  return sendMessage.mock.calls
    .map(([msg]) => msg as unknown as DownloadRequest)
    .filter((msg) => msg.action === 'DOWNLOAD_MD');
}

// Resolves when the export a closed popup left behind has ended.
function exportEnded(watcher: ReturnType<typeof openPopup>): Promise<void> {
  return new Promise((resolve) => {
    const check = () =>
      watcher.received.some((m) => (m as SingleExportState).action === 'SINGLE_EXPORT_STATE' && (m as SingleExportState).busy === null)
        ? resolve()
        : setTimeout(check, 5);
    check();
  });
}

describe('popup export', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();
  const open = vi.fn();

  beforeEach(() => {
    buildTweet();
    sendMessage.mockClear();
    downloadAnswer = { success: true, downloadId: 1 };
    downloadHeld = Promise.resolve();
    writeText.mockReset().mockResolvedValue(undefined);
    open.mockReset();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    window.open = open as typeof window.open;
  });

  it('gives the post to the open popup and does not export it itself', async () => {
    const popup = openPopup();
    popup.send(request('download'));
    const result = await popup.next<{ response: { success: boolean; data?: { markdown: string } } }>('SINGLE_EXPORT_RESULT');
    expect(result.response.success).toBe(true);
    expect(result.response.data?.markdown).toContain('A tweet');

    popup.send({ action: 'SINGLE_EXPORT_CLAIM' });
    popup.close();
    await new Promise((r) => setTimeout(r, 20));
    expect(downloads()).toHaveLength(0);
    expect(toastText()).toBe('');
  });

  it('downloads the post itself when the popup closes during the export', async () => {
    const popup = openPopup();
    popup.send(request('download', 'md', { filenameTemplate: 'from-popup-{id}' }));
    popup.close();
    const watcher = openPopup();
    await exportEnded(watcher);

    // The popup's form, not the saved settings, decides the file.
    expect(downloads()).toEqual([expect.objectContaining({ filename: 'from-popup-222.md' })]);
    expect(downloads()[0].content).toContain('A tweet');
    expect(toastText()).toBe('downloaded');
  });

  it('downloads the post itself when the popup closes after it got the post', async () => {
    const popup = openPopup();
    popup.send(request('download'));
    await popup.next('SINGLE_EXPORT_RESULT');
    popup.close();
    const watcher = openPopup();
    await exportEnded(watcher);

    expect(downloads()).toHaveLength(1);
    expect(toastText()).toBe('downloaded');
  });

  it('copies the note and opens Obsidian when the popup closes', async () => {
    const popup = openPopup();
    popup.send(request('obsidian'));
    popup.close();
    const watcher = openPopup();
    await exportEnded(watcher);

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('A tweet'));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^obsidian:\/\/new\?file=/), '_blank', 'noopener');
    expect(toastText()).toBe('obsidian_opened');
  });

  it('uses the selected format when the popup closes', async () => {
    const popup = openPopup();
    popup.send(request('download', 'txt'));
    popup.close();
    const watcher = openPopup();
    await exportEnded(watcher);

    expect(downloads()).toEqual([expect.objectContaining({ filename: 'alice-222.txt' })]);
  });

  it('tells a popup opened again that the export continues', async () => {
    const popup = openPopup();
    popup.send(request('copy'));
    popup.close();
    const reopened = openPopup();

    expect(reopened.received[0]).toEqual({ action: 'SINGLE_EXPORT_STATE', busy: 'copy' });
    await exportEnded(reopened);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('A tweet'));
    expect(toastText()).toBe('copied');
  });

  // The popup's own download goes through the content script, because the
  // background can take long to answer (zip mode fetches the media first).
  const fileRequest: DownloadRequest = { action: 'DOWNLOAD_MD', content: '# Note', filename: 'note.md' };

  it('answers the open popup with the download result', async () => {
    const popup = openPopup();
    popup.send(request('download'));
    await popup.next('SINGLE_EXPORT_RESULT');
    popup.send({ action: 'SINGLE_EXPORT_DOWNLOAD', request: fileRequest });

    expect(await popup.next('SINGLE_EXPORT_DOWNLOADED')).toEqual({ action: 'SINGLE_EXPORT_DOWNLOADED', error: null });
    expect(downloads()).toEqual([fileRequest]);
    expect(toastText()).toBe('');
  });

  it('shows the download error on the page when the popup closed before the answer', async () => {
    let release = () => {};
    downloadHeld = new Promise((r) => (release = r));
    downloadAnswer = { success: false, error: 'Disk full' };
    const popup = openPopup();
    popup.send(request('download'));
    await popup.next('SINGLE_EXPORT_RESULT');
    popup.send({ action: 'SINGLE_EXPORT_DOWNLOAD', request: fileRequest });
    popup.close();

    const reopened = openPopup();
    expect(reopened.received[0]).toEqual({ action: 'SINGLE_EXPORT_STATE', busy: 'download' });
    release();
    await exportEnded(reopened);

    // Only the popup's download, not a second one from the content script.
    expect(downloads()).toEqual([fileRequest]);
    expect(toastText()).toBe('Disk full');
  });

  it('tells a new popup nothing when no export runs', () => {
    expect(openPopup().received).toEqual([]);
  });

  it('shows the error on the page when the export fails after the popup closed', async () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: '/home', href: 'https://x.com/home', hash: '' },
      writable: true,
      configurable: true,
    });
    const popup = openPopup();
    popup.send(request('download'));
    popup.close();
    const watcher = openPopup();
    await exportEnded(watcher);

    expect(downloads()).toHaveLength(0);
    expect(toastText()).toMatch(/^Not on an X\.com status page/);
  });
});
