import type { ExtractedContent, TweetMetadata } from '../types/messages';
import { domToAst } from './dom-to-ast';
import { docToExtracted } from '../shared/extracted-content';
import {
  delay,
  extractAuthorFromArticle,
  extractTweetId,
  getTweetStatusId,
  threadRun,
} from './dom';

/**
 * Extract engagement metadata from a tweet's role="group" aria-label.
 * Example: "3 replies, 5 reposts, 152 likes, 175 bookmarks, 45025 views"
 */
export function extractEngagementMetadata(
  scope: Element | Document = document
): TweetMetadata | undefined {
  const group = scope.querySelector('[role="group"][aria-label]');
  if (!group) return undefined;

  const label = group.getAttribute('aria-label') || '';
  if (!label) return undefined;

  const meta: TweetMetadata = {};

  const replies = extractCount(label, 'repl');
  if (replies !== undefined) meta.replies = replies;

  const reposts = extractCount(label, 'repost');
  if (reposts !== undefined) meta.reposts = reposts;

  const likes = extractCount(label, 'like');
  if (likes !== undefined) meta.likes = likes;

  const bookmarks = extractCount(label, 'bookmark');
  if (bookmarks !== undefined) meta.bookmarks = bookmarks;

  const views = extractCount(label, 'view');
  if (views !== undefined) meta.views = views;

  return Object.keys(meta).length > 0 ? meta : undefined;
}

// Parses counts from X's aria-labels, handling K/M/B suffixes ("1.5K likes").
function extractCount(label: string, metricPrefix: string): number | undefined {
  const match = label.match(new RegExp(`([\\d,.]+\\s*[kmb]?)\\s*${metricPrefix}`, 'i'));
  if (!match) return undefined;

  const normalized = match[1].replace(/,/g, '').replace(/\s+/g, '').toLowerCase();
  const countMatch = normalized.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!countMatch) return undefined;

  const value = Number(countMatch[1]);
  const suffix = countMatch[2];
  const multiplier = suffix === 'b' ? 1_000_000_000 : suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1;
  return Math.round(value * multiplier);
}

// Detect promoted ("Ad" / "Promoted") tweets so thread collection can skip
// them without treating them as the reply boundary. The label lives inside
// the article's User-Name header area (sibling to name/handle/timestamp).
const PROMOTED_LABELS = new Set(
  [
    'promoted',
    'ad',
    'promoted tweet',
    '広告',
    'プロモーション',
    'プロモツイート',
    'werbung',
    'anuncio',
    'patrocinado',
    'promu',
    '广告',
    'إعلان',
    'تبلیغ',
  ].map((l) => l.toLowerCase())
);

export function isPromotedArticle(article: Element): boolean {
  if (article.querySelector('[data-testid="promotedIndicator"]')) return true;
  const userNames = article.querySelectorAll('[data-testid="User-Name"]');
  for (const un of userNames) {
    // Only consider the outer article's header, not a quoted tweet's.
    if (un.closest('[role="link"]')) continue;
    const spans = un.querySelectorAll('span, div');
    for (const el of spans) {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (PROMOTED_LABELS.has(text)) return true;
    }
  }
  return false;
}


/**
 * Scroll-aware thread extraction.
 *
 * X.com uses a virtualized list — only tweets near the viewport exist in the
 * DOM at any given moment. Deep-link permalinks (e.g. /status/<reply_id>)
 * also anchor the viewport to the focused tweet; ancestor tweets above it
 * are lazy-loaded only when the user scrolls up past that anchor.
 *
 * To capture a full thread we:
 *   1. Walk UP: repeatedly scrollTo(0) until the DOM stops growing above —
 *      this coaxes X into hydrating ancestors all the way to the thread root.
 *   2. Take the thread author from the requested post — not the topmost one,
 *      which for a reply is the post it replies to.
 *   3. Walk DOWN, collecting that author's run of tweets around the requested
 *      post (deduped by status id) until a different-author tweet appears
 *      (start of the reply section), or scrolling yields nothing new (thread
 *      complete).
 *
 * When `singleTweet` is set, the walk is skipped and only the focused article
 * (the one whose status id matches the page url) is extracted.
 */
export async function extractTweetAsync(
  opts: { singleTweet?: boolean } = {}
): Promise<ExtractedContent> {
  let rehydrateHost: Element | null = null;
  if (!opts.singleTweet) {
    rehydrateHost = await loadThreadIntoDom();
  }
  try {
    return docToExtracted(domToAst({ singleTweet: opts.singleTweet }));
  } finally {
    // Always tear down the off-screen rehydration host so the live page
    // returns to a clean state, even if extraction throws.
    rehydrateHost?.remove();
  }
}

// Wait until a new article mounts or the page grows taller (X streamed in more
// of the thread), polling fast and returning the instant something appears — or
// false once idleCapMs passes with no change. Replaces fixed settle delays:
// the ceiling is unchanged, so a slow render still gets its full window, but a
// step where content has already mounted no longer pays the whole wait.
async function waitForGrowth(
  beforeCount: number,
  beforeHeight: number,
  idleCapMs: number
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < idleCapMs) {
    await delay(80);
    if (
      document.querySelectorAll('article[role="article"]').length > beforeCount ||
      document.documentElement.scrollHeight > beforeHeight
    ) {
      return true;
    }
  }
  return false;
}

async function loadThreadIntoDom(): Promise<Element | null> {
  // Fresh map per extraction — keeps memory bounded in long X.com SPA
  // sessions where the user navigates between threads.
  const captured: Map<string, Element> = new Map();
  // The posts above the thread, which it answers (issue #154).
  const context: Map<string, Element> = new Map();

  // A freshly navigated permalink may show only the focal tweet while the
  // conversation timeline streams in; walking immediately would conclude
  // "thread complete" with just the root captured. Give replies a bounded
  // window to start mounting — only when the page is visibly still loading,
  // so settled pages pay nothing.
  const READY_BUDGET_MS = 3000;
  const readyStart = Date.now();
  while (
    Date.now() - readyStart < READY_BUDGET_MS &&
    document.querySelectorAll('article[role="article"]').length <= 1 &&
    isTimelineLoading()
  ) {
    await delay(250);
  }

  // The thread author is the requested post's, not the topmost post's: for a
  // reply, the posts it replies to sit above it (issue #153). Found before
  // the upward walk, which can unmount it under a long chain of those.
  const focalId = extractTweetId();
  const focal = Array.from(document.querySelectorAll('article[role="article"]'))
    .find((a) => !isPromotedArticle(a) && getTweetStatusId(a) === focalId);
  if (!focal) return null;
  const threadAuthor = extractAuthorFromArticle(focal);

  // Upward walk: coax X into loading any ancestors above the focused tweet.
  // No capture yet — the author's earlier posts in the thread are among them.
  const MAX_UP_STEPS = 30;
  // Ancestors render with the conversation view rather than streaming in lazily,
  // so a short idle cap confirms "nothing more above" quickly; a genuinely long
  // chain still walks fully via the growth signal (only the final no-growth step
  // pays the cap).
  const UP_SETTLE_CAP = 300;
  for (let step = 0; step < MAX_UP_STEPS; step++) {
    const beforeCount = document.querySelectorAll('article[role="article"]').length;
    const beforeHeight = document.documentElement.scrollHeight;
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (!(await waitForGrowth(beforeCount, beforeHeight, UP_SETTLE_CAP))) break;
  }

  // X.com virtualizes the timeline — articles scrolled off-screen are
  // detached from the DOM. We snapshot each thread article via cloneNode
  // during the walk and re-attach any that are missing at the end, so
  // domToAst sees the whole thread regardless of viewport state.
  //
  // First capture — the thread around the requested post, bounded by other
  // authors' posts so reply-section tweets by the author (e.g. "thank you!
  // means a lot" in response to a comment) don't pollute the captured set.
  captureArticles(captured, context, threadAuthor.handle, focalId);

  let threadDone = false;
  const SCROLL_STEP = Math.max(window.innerHeight * 0.6, 400);
  const MAX_STEPS = 60;

  for (let step = 0; step < MAX_STEPS && !threadDone; step++) {
    const articleCount = document.querySelectorAll('article[role="article"]').length;
    const sizeBefore = captured.size;
    threadDone = captureArticles(captured, context, threadAuthor.handle, focalId);
    if (threadDone) break;

    const atBottom =
      window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 50;
    if (atBottom && captured.size === sizeBefore) break;
    const beforeHeight = document.documentElement.scrollHeight;
    window.scrollBy({ top: SCROLL_STEP, behavior: 'instant' });
    // Continue the instant the next thread tweet mounts, but still allow the
    // full 400 ms when it streams in slowly — same ceiling as before, so a slow
    // render never truncates the thread.
    await waitForGrowth(articleCount, beforeHeight, 400);
  }

  // Final pass: capture at bottom, scroll-back-to-top + settle + capture.
  captureArticles(captured, context, threadAuthor.handle, focalId);
  window.scrollTo({ top: 0, behavior: 'instant' });
  await delay(250);
  captureArticles(captured, context, threadAuthor.handle, focalId);
  return rehydrateMissingArticles(captured, context, threadAuthor.handle);
}

// X shows a [role="progressbar"] spinner while a timeline streams in. Note a
// fully loaded page often KEEPS one (the infinite-scroll loader at the bottom
// of the replies), so spinner-visible can only gate a bounded wait — never an
// unbounded "still loading" loop.
function isTimelineLoading(): boolean {
  return !!document.querySelector('main [role="progressbar"]');
}

// Hydration score for an article snapshot: mounted videos and src-bearing
// photos. A tweet cell can enter the DOM before its media hydrates; a clone
// taken at that moment would lose the images for good, so captures with a
// higher score replace earlier ones. Text length breaks ties (e.g. link-card
// descriptions that stream in late).
function hydrationScore(article: Element): number {
  let score = article.querySelectorAll('video').length * 2;
  for (const img of article.querySelectorAll('[data-testid="tweetPhoto"] img')) {
    if ((img as HTMLImageElement).src) score += 1;
  }
  return score;
}

// Snapshot helpers. We use cloneNode rather than outerHTML so X.com-specific
// markup (article cards, link cards, etc.) round-trips without parsing, and
// so there's no HTML-string injection path. Clones are detached; originals
// stay live. Captures only the thread run around the requested post — or
// around a post captured earlier, once scrolling has unmounted the requested
// one — so reply-section tweets by the author aren't swept in, plus the posts
// above that run into `context`. Returns whether the run's end (the comment
// boundary) is on the page.
function captureArticles(
  store: Map<string, Element>,
  context: Map<string, Element>,
  authorHandle: string,
  focalId: string
): boolean {
  const live = Array.from(document.querySelectorAll('article[role="article"]'))
    .filter((a) => !isPromotedArticle(a));
  const { run, ended } = threadRun(live, authorHandle, (a) => {
    const id = getTweetStatusId(a);
    return id === focalId || store.has(id);
  });
  for (const article of run) keepSnapshot(store, article);
  if (run.length > 0) {
    for (const article of live.slice(0, live.indexOf(run[0]))) keepSnapshot(context, article);
  }
  return ended;
}

function keepSnapshot(store: Map<string, Element>, article: Element): void {
  const id = getTweetStatusId(article);
  if (!id) return;
  const existing = store.get(id);
  if (existing) {
    // Re-capture only if this pass sees a better-hydrated version.
    // Map.set on an existing key keeps insertion order, so thread order
    // is preserved.
    const oldScore = hydrationScore(existing);
    const newScore = hydrationScore(article);
    if (
      newScore < oldScore ||
      (newScore === oldScore &&
        (article.textContent || '').length <= (existing.textContent || '').length)
    ) {
      return;
    }
  }
  store.set(id, article.cloneNode(true) as Element);
}

// Inject ALL captured thread articles, after the posts they answer
// (`context`), into an off-screen host so domToAst has a guaranteed-ordered,
// virtualization-independent source for the thread and its context. Thread
// order is `store`'s insertion order — established by the bounded
// downward walk (which sees tweets in thread/chronological order as X
// loads them on scroll). domToAst sorts rehydrated articles ahead of live
// ones; same-id live duplicates get dropped via id dedup in
// collectSameAuthorArticles. Off-screen positioning (position:absolute +
// left:-99999px + visibility:hidden + pointer-events:none) keeps X's
// virtualizer from noticing.
//
// Returns the host so the caller can remove it after extraction.
function rehydrateMissingArticles(
  store: Map<string, Element>,
  context: Map<string, Element>,
  authorHandle: string,
): Element | null {
  if (store.size === 0) return null;

  const host = document.createElement('div');
  host.setAttribute('data-xclipper-rehydrate-host', '');
  host.setAttribute(
    'style',
    'position:absolute;left:-99999px;top:0;width:1px;height:1px;' +
      'visibility:hidden;pointer-events:none;overflow:hidden;',
  );

  // The context goes first, oldest first, so domToAst finds it above the
  // thread. Sorted by id rather than capture order: ids grow with time, and a
  // pass that scrolled past the top may have captured a later post first.
  const byAge = (a: string, b: string) => a.length - b.length || (a < b ? -1 : 1);
  for (const id of [...context.keys()].sort(byAge)) {
    host.appendChild(rehydratedCell(id, context.get(id)!));
  }

  // Iterate the Map in insertion order — JS Map preserves it. captureArticles'
  // boundary break ensures only thread tweets land here, so the order is the
  // walk's chronological encounter order = thread order.
  const target = authorHandle.toLowerCase();
  for (const [id, snapshot] of store) {
    // Sanity: re-verify the snapshot still parses as same-author.
    const a = extractAuthorFromArticle(snapshot);
    if (a.handle.toLowerCase() !== target) continue;
    host.appendChild(rehydratedCell(id, snapshot));
  }

  // Attach as last body child — domToAst's rehydrated-first sort handles
  // ordering vs live cells, so we don't need a specific anchor.
  document.body.appendChild(host);
  return host;
}

function rehydratedCell(id: string, snapshot: Element): Element {
  const cell = document.createElement('div');
  cell.setAttribute('data-testid', 'cellInnerDiv');
  cell.setAttribute('data-xclipper-rehydrated', id);
  // cloneNode again so the stored snapshot stays usable if rehydrate
  // runs more than once during the page's lifetime.
  cell.appendChild(snapshot.cloneNode(true));
  return cell;
}
