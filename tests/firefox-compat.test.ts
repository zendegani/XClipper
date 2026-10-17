import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Firefox is stricter than Chrome in two places Auto Full/Auto Fast depend on:
// permissions.request() is only honoured while the click is being dispatched
// (not from an async callback), and webRequest has no 'extraHeaders' option.

type Chrome = Record<string, Record<string, unknown>>;
const chromeGlobal = (globalThis as unknown as { chrome: Chrome }).chrome;

describe('popup engine selector under Firefox permission rules', () => {
  let inClick = false;

  beforeEach(async () => {
    vi.resetModules();
    const html = readFileSync(resolve(__dirname, '../src/popup/popup.html'), 'utf8');
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    // Nothing granted yet; answers arrive asynchronously, as in Firefox.
    chromeGlobal.permissions = {
      contains: (_p: unknown, cb: (has: boolean) => void) => setTimeout(() => cb(false)),
      request: (_p: unknown, cb: (granted: boolean) => void) => {
        const granted = inClick;
        setTimeout(() => cb(granted));
      },
    };
    const { initBatchEngineUi } = await import('../src/popup/batch-engine-ui');
    initBatchEngineUi();
  });

  function click(id: string): void {
    inClick = true;
    document.getElementById(id)!.click();
    inClick = false;
  }

  it('selects Auto Full when the user allows the permission', async () => {
    click('mode-auto');
    await vi.waitFor(() => expect(document.getElementById('mode-auto')!.classList.contains('active')).toBe(true));
    expect(document.getElementById('mode-manual')!.classList.contains('active')).toBe(false);
  });
});

describe('X session capture', () => {
  let addListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    addListener = vi.fn();
  });

  it('omits extraHeaders where the browser has no such option (Firefox)', async () => {
    chromeGlobal.webRequest = { onBeforeSendHeaders: { addListener } };
    const { startCapturing } = await import('../src/background/x-session');
    startCapturing();
    expect(addListener.mock.calls[0][2]).toEqual(['requestHeaders']);
  });

  it('asks for extraHeaders where the browser supports it (Chrome)', async () => {
    chromeGlobal.webRequest = {
      onBeforeSendHeaders: { addListener },
      OnBeforeSendHeadersOptions: { EXTRA_HEADERS: 'extraHeaders' },
    };
    const { startCapturing } = await import('../src/background/x-session');
    startCapturing();
    expect(addListener.mock.calls[0][2]).toEqual(['requestHeaders', 'extraHeaders']);
  });
});
