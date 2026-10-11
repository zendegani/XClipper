import { describe, expect, it, vi } from 'vitest';
import { dispatch, type Routes } from '../src/background/router';

// tests/setup.ts sets chrome.runtime.id to 'test-extension'.
const popup = {
  id: 'test-extension',
  url: 'chrome-extension://test-extension/popup.html',
} as chrome.runtime.MessageSender;
const xContent = {
  id: 'test-extension',
  url: 'https://x.com/someone/status/1',
  tab: { id: 3 },
} as chrome.runtime.MessageSender;
const otherSite = {
  id: 'test-extension',
  url: 'https://example.com/',
} as chrome.runtime.MessageSender;

// Real action names, so the table type-checks. The handlers are stand-ins.
const routes: Routes = {
  FAST_BATCH_CANCEL: { trust: ['extension-page'], handle: () => ({ ok: true }) },
  BATCH_ITEM_RESULT: { trust: ['x-content'], handle: async () => ({ ok: 'later' }) },
  XCLIPPER_CTX_URL: { trust: ['extension-page', 'x-content'], handle: () => undefined },
};
const SYNC = { action: 'FAST_BATCH_CANCEL' };
const ASYNC = { action: 'BATCH_ITEM_RESULT' };
const SILENT = { action: 'XCLIPPER_CTX_URL' };

function send(msg: unknown, sender: chrome.runtime.MessageSender, table = routes) {
  const respond = vi.fn();
  const keepOpen = dispatch(table, msg, sender, respond);
  return { keepOpen, respond };
}

describe('dispatch()', () => {
  it('sends the return value of a sync handler and closes the channel', () => {
    const { keepOpen, respond } = send(SYNC, popup);
    expect(keepOpen).toBe(false);
    expect(respond).toHaveBeenCalledWith({ ok: true });
  });

  it('keeps the channel open until an async handler resolves', async () => {
    const { keepOpen, respond } = send(ASYNC, xContent);
    expect(keepOpen).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ ok: 'later' }));
  });

  it('sends an error response when an async handler rejects', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const table: Routes = {
      BATCH_ITEM_RESULT: {
        trust: ['x-content'],
        handle: async () => {
          throw new Error('storage failed');
        },
      },
    };
    const { keepOpen, respond } = send(ASYNC, xContent, table);
    expect(keepOpen).toBe(true);
    await vi.waitFor(() =>
      expect(respond).toHaveBeenCalledWith({ success: false, error: 'storage failed' })
    );
    expect(logError).toHaveBeenCalledWith(
      '[xclipper bg]',
      'BATCH_ITEM_RESULT failed:',
      expect.any(Error)
    );
    logError.mockRestore();
  });

  it('sends no response when the handler returns undefined', () => {
    const { keepOpen, respond } = send(SILENT, xContent);
    expect(keepOpen).toBe(false);
    expect(respond).not.toHaveBeenCalled();
  });

  it('ignores a sender that the trust rule does not list', () => {
    const handle = vi.fn();
    const table: Routes = { FAST_BATCH_CANCEL: { trust: ['extension-page'], handle } };
    const { keepOpen, respond } = send(SYNC, xContent, table);
    expect(keepOpen).toBe(false);
    expect(handle).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
  });

  it('ignores a sender from a site other than x.com', () => {
    const { keepOpen, respond } = send(SILENT, otherSite);
    expect(keepOpen).toBe(false);
    expect(respond).not.toHaveBeenCalled();
  });

  it('ignores unknown actions and malformed messages', () => {
    for (const msg of [{ action: 'NOPE' }, { action: 'toString' }, null, 'FAST_BATCH_CANCEL', {}]) {
      const { keepOpen, respond } = send(msg, popup);
      expect(keepOpen, JSON.stringify(msg)).toBe(false);
      expect(respond).not.toHaveBeenCalled();
    }
  });
});
