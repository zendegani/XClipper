import { describe, it, expect, afterEach } from 'vitest';
import { loadSettings, SETTINGS_KEY, DEFAULT_SETTINGS } from '../src/shared/settings';

// Point chrome.storage.local.get at a fixed saved object for one call.
function withSaved(saved: Record<string, unknown>): void {
  (globalThis as unknown as { chrome: { storage: { local: { get: unknown } } } }).chrome.storage.local.get = (
    _keys: unknown,
    cb: (r: Record<string, unknown>) => void
  ) => cb({ [SETTINGS_KEY]: saved });
}

const originalGet = (globalThis as unknown as { chrome: { storage: { local: { get: unknown } } } }).chrome.storage
  .local.get;

afterEach(() => {
  (globalThis as unknown as { chrome: { storage: { local: { get: unknown } } } }).chrome.storage.local.get =
    originalGet;
});

describe('loadSettings() upgrade behavior', () => {
  // The reason saveVideos is a second boolean rather than downloadImages being
  // replaced by an enum: DEFAULT_SETTINGS is spread OVER the saved partial, so
  // any key an existing user has never written takes the default. A
  // replacement key would have defaulted every current user to 'off' and
  // silently stopped saving their images.
  it('keeps local images on for a user who saved before saveVideos existed', async () => {
    withSaved({ downloadImages: true });

    const settings = await loadSettings();

    expect(settings.downloadImages).toBe(true);
    expect(settings.saveVideos).toBe(false);
  });

  it('defaults both off when nothing is saved', async () => {
    withSaved({});

    const settings = await loadSettings();

    expect(settings.downloadImages).toBe(false);
    expect(settings.saveVideos).toBe(false);
  });

  it('round-trips an explicit Media selection', async () => {
    withSaved({ downloadImages: true, saveVideos: true });

    const settings = await loadSettings();

    expect(settings.downloadImages).toBe(true);
    expect(settings.saveVideos).toBe(true);
  });

  it('ships saveVideos off by default', () => {
    expect(DEFAULT_SETTINGS.saveVideos).toBe(false);
  });
});
