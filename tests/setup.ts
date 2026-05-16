// Minimal chrome-extension API shim so importing content scripts under jsdom
// doesn't blow up when they register listeners or read storage.

const noop = () => {};
const listeners = new Set<unknown>();

(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    onMessage: { addListener: (fn: unknown) => listeners.add(fn) },
    sendMessage: noop,
    lastError: undefined,
    id: 'test-extension',
  },
  storage: {
    local: {
      get: (_keys: unknown, cb: (r: Record<string, unknown>) => void) => cb({}),
      set: noop,
    },
    onChanged: { addListener: noop },
  },
  contextMenus: {
    create: noop,
    removeAll: (cb?: () => void) => cb?.(),
    onClicked: { addListener: noop },
  },
  tabs: { create: noop, query: noop, sendMessage: noop },
  i18n: { getMessage: (k: string) => k },
  downloads: { download: noop },
};

// jsdom doesn't implement scrollTo/scrollBy and logs a "Not implemented"
// warning when extractor code auto-scrolls to load more tweets. Stub them.
window.scrollTo = noop as typeof window.scrollTo;
window.scrollBy = noop as typeof window.scrollBy;
