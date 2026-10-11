import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Routes } from '../src/background/router';

// Imports background.ts for its route table only: listen() is captured, and
// the batch engines are not started.

let routes: Routes = {};

vi.mock('../src/background/router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/background/router')>();
  return { ...actual, listen: (table: Routes) => void (routes = table) };
});
vi.mock('../src/background/batch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/background/batch')>();
  return { ...actual, initBatch: () => {} };
});
vi.mock('../src/background/fast-batch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/background/fast-batch')>();
  return { ...actual, initFastBatch: () => {} };
});

const runtime = (globalThis as unknown as { chrome: { runtime: Record<string, unknown> } }).chrome
  .runtime;
runtime.onInstalled = { addListener: () => {} };
runtime.onStartup = { addListener: () => {} };

await import('../src/background/background');
const { dispatch } = await import('../src/background/router');

describe('background message routes', () => {
  // A change to this table changes who may do what. Review it as a security
  // change.
  it('gives each action its trust rule', () => {
    const trust = Object.fromEntries(Object.entries(routes).map(([a, r]) => [a, r.trust]));
    expect(trust).toEqual({
      XCLIPPER_CTX_URL: ['x-content'],
      RESOLVE_VIDEO_URLS: ['extension-page'],
      PDF_PRINT_REQUEST: ['x-content'],
      DOWNLOAD_MD: ['x-content', 'extension-page'],
      BATCH_START: ['extension-page', 'x-content'],
      BATCH_APPEND: ['extension-page', 'x-content'],
      BATCH_CONTROL: ['extension-page'],
      BATCH_STATUS: ['extension-page'],
      BATCH_ITEM_RESULT: ['x-content'],
      FAST_BATCH_START: ['extension-page'],
      FAST_BATCH_STATUS: ['extension-page'],
      FAST_BATCH_CANCEL: ['extension-page'],
      FAST_BATCH_READY: ['extension-page'],
    });
  });

  it('rejects PDF_PRINT_REQUEST from a page that is not x.com', () => {
    const respond = vi.fn();
    const sender = { id: 'test-extension', url: 'https://example.com/' } as chrome.runtime.MessageSender;
    const msg = { action: 'PDF_PRINT_REQUEST', html: '<p>x</p>', filenameBase: 'x' };
    expect(dispatch(routes, msg, sender, respond)).toBe(false);
    expect(respond).not.toHaveBeenCalled();
  });

  // A listener outside the router would skip the trust check.
  it('has no onMessage listener in the background other than the router', () => {
    const dir = 'src/background';
    const listeners = readdirSync(dir).filter((f) =>
      readFileSync(`${dir}/${f}`, 'utf8').includes('onMessage.addListener')
    );
    expect(listeners).toEqual(['router.ts']);
  });
});
