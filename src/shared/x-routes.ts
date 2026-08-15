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
  // Whose page it is, when the route names an account: a profile's owner, or
  // the account whose likes are shown on the legacy `/<handle>/likes` route.
  // The History routes are always the signed-in user's own, so they carry none.
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

  // X moved Bookmarks and Likes under one History hub. Likes is tested first,
  // or `/i/history/likes` reads as the hub's own path. The hub's other tabs
  // (Videos, Articles) are deliberately left unmatched — they hold browsing
  // history, not saved posts, and must never export as bookmarks.
  if (path === '/i/history/likes') return { source: 'likes' };
  if (path === '/i/history' || path === '/i/history/bookmarks') return { source: 'bookmarks' };
  // Pre-History route, still resolving for accounts the rollout hasn't reached.
  // Prefix-matched because bookmark folders sit underneath it.
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
