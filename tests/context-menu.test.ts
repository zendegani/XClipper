import { describe, expect, it, vi } from 'vitest';

// Imports background.ts for its context menu only; the batch engines are not
// started.

vi.mock('../src/background/manual-batch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/background/manual-batch')>();
  return { ...actual, initManualBatch: () => {} };
});
vi.mock('../src/background/graphql-batch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/background/graphql-batch')>();
  return { ...actual, initGraphqlBatch: () => {} };
});

type MenuItem = chrome.contextMenus.CreateProperties;
type Click = { linkUrl?: string; srcUrl?: string; selection?: boolean };

const created: MenuItem[] = [];
const opened: string[] = [];
const installed: (() => void)[] = [];
let onClick: (info: { menuItemId: string; linkUrl?: string; pageUrl: string }, tab: object) => void = () => {};

const chromeGlobal = (globalThis as unknown as { chrome: Record<string, Record<string, unknown>> }).chrome;
chromeGlobal.runtime.onInstalled = { addListener: (fn: () => void) => void installed.push(fn) };
chromeGlobal.runtime.onStartup = { addListener: () => {} };
chromeGlobal.contextMenus = {
  create: (item: MenuItem) => void created.push(item),
  removeAll: (cb: () => void) => cb(),
  onClicked: { addListener: (fn: typeof onClick) => (onClick = fn) },
};
chromeGlobal.tabs = { ...chromeGlobal.tabs, create: ({ url }: { url: string }) => void opened.push(url) };

await import('../src/background/background');
installed.forEach((fn) => fn());

const matches = (patterns: string[], url: string): boolean =>
  patterns.some((p) => new RegExp('^' + p.replace(/[.?]/g, '\\$&').replace(/\*/g, '.*') + '$').test(url));

// Each browser's rule for showing an item, from their source: Chrome's
// ExtensionContextAndPatternMatch and Firefox's enabledForContext.
// srcUrl stands for an image under the cursor.
const shows = {
  chrome: (item: MenuItem, click: Click): boolean => {
    const has = (c: chrome.contextMenus.ContextType): boolean => !!item.contexts?.includes(c);
    const targets = item.targetUrlPatterns ?? ['*'];
    if (click.selection && has('selection')) return true;
    if (click.linkUrl && has('link') && matches(targets, click.linkUrl)) return true;
    if (click.srcUrl && has('image') && matches(targets, click.srcUrl)) return true;
    return !click.linkUrl && !click.srcUrl && !click.selection && has('page');
  },
  firefox: (item: MenuItem, click: Click): boolean => {
    const contexts = [
      ...(click.linkUrl ? ['link'] : []),
      ...(click.srcUrl ? ['image'] : []),
      ...(click.selection ? ['selection'] : []),
    ];
    if (contexts.length === 0) contexts.push('page');
    if (!contexts.some((c) => item.contexts?.includes(c as chrome.contextMenus.ContextType))) return false;
    const targets = [click.linkUrl, click.srcUrl].filter((u): u is string => !!u);
    return !item.targetUrlPatterns || targets.some((u) => matches(item.targetUrlPatterns!, u));
  },
};

describe('context menu', () => {
  const topLevel = created.filter((item) => !item.parentId);

  for (const browser of ['chrome', 'firefox'] as const) {
    const visible = (click: Click): number => topLevel.filter((item) => shows[browser](item, click)).length;

    it(`shows one XClipper menu on a post or its link in ${browser}`, () => {
      expect(visible({})).toBe(1);
      expect(visible({ linkUrl: 'https://x.com/a/status/1' })).toBe(1);
      expect(visible({ linkUrl: 'https://x.com/a/status/1/photo/1', srcUrl: 'https://pbs.twimg.com/media/a.jpg' })).toBe(1);
    });

    it(`shows no menu on other links in ${browser}`, () => {
      expect(visible({ linkUrl: 'https://x.com/a' })).toBe(0);
    });

    it(`shows no menu on selected text or an unlinked image in ${browser}`, () => {
      expect(visible({ selection: true })).toBe(0);
      expect(visible({ srcUrl: 'https://pbs.twimg.com/media/a.jpg' })).toBe(0);
    });
  }

  it('gives every item a unique id', () => {
    const ids = created.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('runs the same action from either menu', () => {
    opened.length = 0;
    for (const id of ['xclipper-copy-single', 'xclipper-copy-single-page', 'xclipper-copy-txt-page']) {
      onClick({ menuItemId: id, linkUrl: 'https://x.com/a/status/1', pageUrl: 'https://x.com/home' }, {});
    }
    expect(opened).toEqual([
      'https://x.com/a/status/1#xclipper=copy&xclipper_single=1',
      'https://x.com/a/status/1#xclipper=copy&xclipper_single=1',
      'https://x.com/a/status/1#xclipper=copy-txt',
    ]);
  });
});
