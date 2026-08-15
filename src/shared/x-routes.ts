// Which x.com page you're on, as far as batch export cares.
//
// Two callers have to agree on this: the injector, which harvests permalinks
// from the live page, and the popup, which focuses the matching source tab
// from the active tab's URL. They each carried their own matchers until X
// moved Bookmarks and Likes under the History hub and both needed the same
// edit — so the mapping lives here once, pure and tested.

export type XPageSource = 'bookmarks' | 'likes' | 'timeline' | 'profile';

export interface XPage {
  source: XPageSource;
  // Whose page it is, when the route names an account. For a profile that's
  // whoever's posts you're looking at; for the legacy `/<handle>/likes` route
  // it can only ever be you, since X made likes private years ago — it's kept
  // so switching accounts still re-keys the harvest. The History routes name
  // nobody, being always your own.
  handle?: string;
}

// Top-level x.com paths that are app surfaces, not profile handles.
const NON_PROFILE_PATHS = new Set([
  'home', 'explore', 'notifications', 'messages', 'settings', 'search',
  'compose', 'jobs', 'communities', 'premium', 'verified-orgs', 'about',
  'tos', 'privacy', 'login', 'logout', 'signup', 'share', 'intent',
  'hashtag', 'places', 'topics', 'account', 'follower_requests', 'i',
]);

// A pathname only — no origin, no query string. Returns null for any page
// batch export can't harvest, which is most of x.com.
export function pageSourceOfPath(pathname: string): XPage | null {
  const path = pathname.replace(/\/+$/, '');

  // X moved Bookmarks and Likes under one History hub. Bookmarks is the hub's
  // default tab and has no path of its own — selecting it returns to the bare
  // `/i/history`, and `/i/history/bookmarks` just redirects there — so the bare
  // path IS the bookmarks page. Likes is tested first, or its path reads as
  // that bare one.
  //
  // Both are matched exactly, never by prefix. The web hub carries just these
  // two tabs today, but the mobile app already adds Videos and Articles, so
  // more are expected here — and watch history is not something the user saved.
  // Anything new under the hub stays unharvested until this module says
  // otherwise. (If X ever re-points the bare path at a different default tab,
  // the Bookmarks mapping below needs revisiting.)
  if (path === '/i/history/likes') return { source: 'likes' };
  if (path === '/i/history') return { source: 'bookmarks' };
  // Pre-History routes. These now redirect to the hub, so they're only reached
  // on accounts the rollout hasn't finished with — but the redirect means a tab
  // sitting on one is rare either way. Prefix-matched for bookmark folders.
  if (path === '/i/bookmarks' || path.startsWith('/i/bookmarks/')) return { source: 'bookmarks' };

  if (path === '/home') return { source: 'timeline' };

  // Legacy per-account Likes route.
  const liked = path.match(/^\/([A-Za-z0-9_]{1,15})\/likes$/);
  if (liked && !NON_PROFILE_PATHS.has(liked[1].toLowerCase())) {
    return { source: 'likes', handle: liked[1] };
  }

  const profile = path.match(/^\/([A-Za-z0-9_]{1,15})$/);
  if (profile && !NON_PROFILE_PATHS.has(profile[1].toLowerCase())) {
    return { source: 'profile', handle: profile[1] };
  }
  return null;
}
