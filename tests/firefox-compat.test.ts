import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Firefox is stricter than Chrome in two places Auto Full/Auto Fast depend on:
// permissions.request() is only honoured while the click is being dispatched
// (not from an async callback), and webRequest has no 'extraHeaders' option.

type Chrome = Record<string, Record<string, unknown>>;
const chromeGlobal = (globalThis as unknown as { chrome: Chrome }).chrome;
const original = { ...chromeGlobal, storage: { ...chromeGlobal.storage }, tabs: { ...chromeGlobal.tabs } };
afterEach(() => {
  delete chromeGlobal.permissions;
  delete chromeGlobal.webRequest;
  chromeGlobal.storage = original.storage;
  chromeGlobal.tabs = original.tabs;
  document.body.innerHTML = '';
});

describe('popup permission requests under Firefox rules', () => {
  let inClick = false;
  let userAllows = true;
  let popupClosesOnPrompt = false;
  let alreadyGranted = false;
  let stored: Record<string, unknown>;
  let reloaded: number[];

  beforeEach(() => {
    vi.resetModules();
    userAllows = true;
    popupClosesOnPrompt = false;
    alreadyGranted = false;
    stored = {};
    reloaded = [];
    const html = readFileSync(resolve(__dirname, '../src/popup/popup.html'), 'utf8');
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    // Answers arrive asynchronously, and a request outside the click is refused.
    chromeGlobal.permissions = {
      contains: (_p: unknown, cb: (has: boolean) => void) => setTimeout(() => cb(alreadyGranted)),
      request: (_p: unknown, cb: (granted: boolean) => void) => {
        const granted = alreadyGranted || (inClick && userAllows);
        if (!popupClosesOnPrompt) setTimeout(() => cb(granted));
      },
    };
    chromeGlobal.storage = {
      ...original.storage,
      local: {
        get: (_k: unknown, cb: (r: Record<string, unknown>) => void) => cb({}),
        set: (items: Record<string, unknown>) => void Object.assign(stored, items),
      },
    };
    chromeGlobal.tabs = {
      ...original.tabs,
      query: async () => [{ id: 7, url: 'https://x.com/a/status/1' }],
      reload: async (id: number) => void reloaded.push(id),
    };
  });

  function click(id: string): void {
    inClick = true;
    try {
      document.getElementById(id)!.click();
    } finally {
      inClick = false;
    }
  }
  const isActive = (id: string): boolean => document.getElementById(id)!.classList.contains('active');

  async function initEngineUi(): Promise<void> {
    const { initBatchEngineUi } = await import('../src/popup/batch-engine-ui');
    initBatchEngineUi();
  }

  it('selects Auto Full when the user allows the permission', async () => {
    await initEngineUi();
    click('mode-auto');
    await vi.waitFor(() => expect(isActive('mode-auto')).toBe(true));
    expect(isActive('mode-manual')).toBe(false);
  });

  it('falls back to Scroll when the user declines', async () => {
    userAllows = false;
    await initEngineUi();
    click('mode-super');
    await vi.waitFor(() => expect(stored.batchMode).toBe('manual'));
    expect(isActive('mode-manual')).toBe(true);
    expect(isActive('mode-super')).toBe(false);
  });

  it('keeps the choice when the prompt closes the popup before it answers', async () => {
    popupClosesOnPrompt = true;
    await initEngineUi();
    click('mode-auto');
    expect(stored.batchMode).toBe('auto');
  });

  it('asks for the video permission from the Media click and reloads the post once granted', async () => {
    const { initSettingsForm } = await import('../src/popup/settings-form');
    initSettingsForm();
    await new Promise((r) => setTimeout(r));
    click('save-local-media');
    await vi.waitFor(() => expect(reloaded).toEqual([7]));
  });

  it('does not reload the post when video access was already granted', async () => {
    alreadyGranted = true;
    const { initSettingsForm } = await import('../src/popup/settings-form');
    initSettingsForm();
    await new Promise((r) => setTimeout(r));
    click('save-local-media');
    await new Promise((r) => setTimeout(r, 10));
    expect(reloaded).toEqual([]);
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
