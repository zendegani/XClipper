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
  if (!opts.singleTweet) {
    await loadThreadIntoDom();
  }
  return astToExtractedContent(domToAst({ singleTweet: opts.singleTweet }));
}

async function loadThreadIntoDom(): Promise<void> {
  // Upward walk: coax X into loading any ancestors above the focused tweet.
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

  // Downward walk: collect same-author articles until the reply boundary,
  // matching what domToAst's thread collector will iterate.
  const firstArticle = Array.from(document.querySelectorAll('article[role="article"]'))
    .find((a) => !isPromotedArticle(a));
  if (!firstArticle) return;
  const threadAuthor = extractAuthorFromArticle(firstArticle);

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
    if (threadDone) break;

    const atBottom =
      window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 50;
    if (atBottom && seen.size === sizeBefore) break;
    window.scrollBy({ top: SCROLL_STEP, behavior: 'instant' });
    await delay(400);
  }

  window.scrollTo({ top: 0, behavior: 'instant' });
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

