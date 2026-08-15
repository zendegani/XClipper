import { describe, expect, it } from 'vitest';
import { pageSourceOfPath } from '../src/shared/x-routes';

// The route table these cover is the one X broke when it moved Bookmarks and
// Likes under the History hub: both batch sources went quiet, with no error to
// notice, because the matchers simply stopped matching.

describe('pageSourceOfPath() — History hub', () => {
  // The hub lands on its Bookmarks tab, so the bare path is a bookmarks page.
  it('reads the hub root as Bookmarks', () => {
    expect(pageSourceOfPath('/i/history')).toEqual({ source: 'bookmarks' });
  });

  it('reads the hub Bookmarks tab as Bookmarks', () => {
    expect(pageSourceOfPath('/i/history/bookmarks')).toEqual({ source: 'bookmarks' });
  });

  it('reads the hub Likes tab as Likes, with no handle', () => {
    expect(pageSourceOfPath('/i/history/likes')).toEqual({ source: 'likes' });
  });

  it('does not let the hub root swallow its Likes tab', () => {
    // `/i/history` must be matched exactly, not by prefix, or the longer path
    // resolves to Bookmarks and every liked post exports into a bookmarks run.
    expect(pageSourceOfPath('/i/history/likes')?.source).toBe('likes');
  });

  // Bookmarks and Likes are the only tabs on the web hub today, but the mobile
  // app already has Videos and Articles and the web rollout is expected to
  // follow. Those hold watch/read history, not saved posts — harvesting them as
  // bookmarks would export things the user never saved. Prefix-matching the hub
  // would do exactly that the day they land.
  it.each(['/i/history/videos', '/i/history/articles'])(
    'refuses to harvest the %s tab if the web rollout adds it',
    (path) => {
      expect(pageSourceOfPath(path)).toBeNull();
    }
  );

  it('ignores a trailing slash', () => {
    expect(pageSourceOfPath('/i/history/')).toEqual({ source: 'bookmarks' });
    expect(pageSourceOfPath('/i/history/likes/')).toEqual({ source: 'likes' });
  });
});

describe('pageSourceOfPath() — pre-History routes', () => {
  it('still reads the old Bookmarks path', () => {
    expect(pageSourceOfPath('/i/bookmarks')).toEqual({ source: 'bookmarks' });
  });

  it('still reads a bookmark folder', () => {
    expect(pageSourceOfPath('/i/bookmarks/1584645550433751040')).toEqual({
      source: 'bookmarks',
    });
  });

  it('still reads the old Likes route, keeping the handle', () => {
    // Only ever your own handle — X made likes private years ago. The handle
    // keys the dedupe set, so switching X accounts starts a fresh harvest
    // rather than inheriting the previous account's.
    expect(pageSourceOfPath('/jack/likes')).toEqual({
      source: 'likes',
      handle: 'jack',
    });
  });
});

describe('pageSourceOfPath() — profiles and timeline', () => {
  it('reads the home feed as the timeline', () => {
    expect(pageSourceOfPath('/home')).toEqual({ source: 'timeline' });
  });

  it('reads a bare handle as that profile', () => {
    expect(pageSourceOfPath('/jack')).toEqual({ source: 'profile', handle: 'jack' });
  });

  it('preserves the handle as written, for display', () => {
    expect(pageSourceOfPath('/ElonMusk')?.handle).toBe('ElonMusk');
  });

  // App surfaces sit at the same depth as a handle. Treating one as a profile
  // would arm the export against a page with no posts to collect.
  it.each([
    '/explore',
    '/notifications',
    '/messages',
    '/settings',
    '/jobs',
    '/communities',
    '/i',
  ])('does not mistake %s for a profile', (path) => {
    expect(pageSourceOfPath(path)).toBeNull();
  });

  it('does not mistake a reserved path with /likes for a Likes page', () => {
    expect(pageSourceOfPath('/settings/likes')).toBeNull();
  });

  it.each([
    '/jack/status/20',
    '/jack/media',
    '/jack/with_replies',
    '/i/bookmarksfoo',
    '/search',
    '/',
  ])('returns null for %s', (path) => {
    expect(pageSourceOfPath(path)).toBeNull();
  });
});
