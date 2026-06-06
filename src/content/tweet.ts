import type { ExtractedContent, TweetMetadata } from '../types/messages';
import type { Document as AstDocument } from '../ast/types';
import { domToAst } from './dom-to-ast';
import { renderMarkdown } from '../ast/render-markdown';
import {
  delay,
  extractAuthorFromArticle,
  getTweetStatusId,
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
 *   2. Pick the topmost non-promoted article as the thread author.
 *   3. Walk DOWN, collecting same-author tweets (deduped by status id) until
 *      a different-author tweet appears (start of the reply section), or
 *      scrolling yields nothing new (thread complete).
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
    return astToExtractedContent(domToAst({ singleTweet: opts.singleTweet }));
  } finally {
    // Always tear down the off-screen rehydration host so the live page
    // returns to a clean state, even if extraction throws.
    rehydrateHost?.remove();
  }
}

async function loadThreadIntoDom(): Promise<Element | null> {
  // Fresh map per extraction — keeps memory bounded in long X.com SPA
  // sessions where the user navigates between threads.
  const captured: Map<string, Element> = new Map();

  // Upward walk: coax X into loading any ancestors above the focused tweet.
  // No capture yet — we don't know the thread author until ancestors settle.
  const MAX_UP_STEPS = 30;
  const UP_SETTLE_DELAY = 500;
  for (let step = 0; step < MAX_UP_STEPS; step++) {
    const beforeCount = document.querySelectorAll('article[role="article"]').length;
    const beforeHeight = document.documentElement.scrollHeight;
    window.scrollTo({ top: 0, behavior: 'instant' });
    await delay(UP_SETTLE_DELAY);
    const afterCount = document.querySelectorAll('article[role="article"]').length;
    const afterHeight = document.documentElement.scrollHeight;
    if (afterCount === beforeCount && afterHeight === beforeHeight) break;
  }

  // X.com virtualizes the timeline — articles scrolled off-screen are
  // detached from the DOM. We snapshot each thread article via cloneNode
  // during the walk and re-attach any that are missing at the end, so
  // domToAst sees the whole thread regardless of viewport state.
  const firstArticle = Array.from(document.querySelectorAll('article[role="article"]'))
    .find((a) => !isPromotedArticle(a));
  if (!firstArticle) return null;
  const threadAuthor = extractAuthorFromArticle(firstArticle);

  // First capture — thread root + nearby tweets currently in DOM, bounded
  // by the same-author boundary so reply-section tweets by the author
  // (e.g. "thank you! means a lot" in response to a comment) don't pollute
  // the captured set.
  captureArticles(captured, threadAuthor.handle);

  const seen = new Set<string>();
  let threadDone = false;
  const SCROLL_STEP = Math.max(window.innerHeight * 0.6, 400);
  const MAX_STEPS = 60;

  for (let step = 0; step < MAX_STEPS && !threadDone; step++) {
    const articles = document.querySelectorAll('article[role="article"]');
    const sizeBefore = seen.size;
    for (const article of articles) {
      if (isPromotedArticle(article)) continue;
      const a = extractAuthorFromArticle(article);
      if (a.handle === 'unknown') continue;
      if (a.handle.toLowerCase() !== threadAuthor.handle.toLowerCase()) {
        threadDone = true;
        break;
      }
      seen.add(getTweetStatusId(article));
    }
    captureArticles(captured, threadAuthor.handle);
    if (threadDone) break;

    const atBottom =
      window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 50;
    if (atBottom && seen.size === sizeBefore) break;
    window.scrollBy({ top: SCROLL_STEP, behavior: 'instant' });
    await delay(400);
  }

  // Final pass: capture at bottom, scroll-back-to-top + settle + capture.
  captureArticles(captured, threadAuthor.handle);
  window.scrollTo({ top: 0, behavior: 'instant' });
  await delay(400);
  captureArticles(captured, threadAuthor.handle);
  return rehydrateMissingArticles(captured, threadAuthor.handle);
}

// Snapshot helpers. We use cloneNode rather than outerHTML so X.com-specific
// markup (article cards, link cards, etc.) round-trips without parsing, and
// so there's no HTML-string injection path. Clones are detached; originals
// stay live. Captures STOP at the first non-author article — the comment
// boundary — so reply-section tweets by the author aren't swept in.
function captureArticles(store: Map<string, Element>, authorHandle: string): void {
  const target = authorHandle.toLowerCase();
  for (const article of document.querySelectorAll('article[role="article"]')) {
    if (isPromotedArticle(article)) continue;
    const a = extractAuthorFromArticle(article);
    if (a.handle === 'unknown') continue;
    if (a.handle.toLowerCase() !== target) break; // boundary
    const id = getTweetStatusId(article);
    if (!id || store.has(id)) continue;
    store.set(id, article.cloneNode(true) as Element);
  }
}

// Inject ALL captured thread articles into an off-screen host so domToAst
// has a guaranteed-ordered, virtualization-independent source for the
// thread. Order is `store`'s insertion order — established by the bounded
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

  // Iterate the Map in insertion order — JS Map preserves it. captureArticles'
  // boundary break ensures only thread tweets land here, so the order is the
  // walk's chronological encounter order = thread order.
  const target = authorHandle.toLowerCase();
  for (const [id, snapshot] of store) {
    // Sanity: re-verify the snapshot still parses as same-author.
    const a = extractAuthorFromArticle(snapshot);
    if (a.handle.toLowerCase() !== target) continue;
    const cell = document.createElement('div');
    cell.setAttribute('data-testid', 'cellInnerDiv');
    cell.setAttribute('data-xclipper-rehydrated', id);
    // cloneNode again so the stored snapshot stays usable if rehydrate
    // runs more than once during the page's lifetime.
    cell.appendChild(snapshot.cloneNode(true));
    host.appendChild(cell);
  }

  // Attach as last body child — domToAst's rehydrated-first sort handles
  // ordering vs live cells, so we don't need a specific anchor.
  document.body.appendChild(host);
  return host;
}

function astToExtractedContent(doc: AstDocument): ExtractedContent {
  const meta = doc.metadata;
  return {
    type: meta.type,
    author: { name: meta.author.name, handle: `@${meta.author.handle}` },
    title: meta.title,
    markdown: renderMarkdown(doc),
    sourceUrl: meta.sourceUrl,
    date: meta.date,
    tweetId: meta.tweetId,
    ...(meta.engagement ? { metadata: meta.engagement } : {}),
    body: doc,
  };
}

