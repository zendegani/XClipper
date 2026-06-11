import type { TweetNode } from '../../ast/types';
import { SELECTORS, extractAuthorFromArticle } from '../dom';
import { stripHandlePrefix, extractDateFromArticle } from './shared';
import { extractInline } from './inline';
import { extractArticleCard } from './cards';
import { extractMedia } from './media';

export function quotedTweetContainer(article: Element): Element | null {
  // Primary path: a tweet quote with its own tweetText element.
  const tweetTextEls = article.querySelectorAll(SELECTORS.tweetText);
  if (tweetTextEls.length >= 2) {
    return tweetTextEls[1].closest('div[role="link"]');
  }
  // Fallback: an article-card quote has no tweetText at all. Look for the
  // article-cover-image inside a quote-style wrapper and return that.
  const cover = article.querySelector('[data-testid="article-cover-image"]');
  return cover ? cover.closest('div[role="link"]') : null;
}

function findStatusIdIn(container: Element): string {
  for (const a of container.querySelectorAll('a[href*="/status/"]')) {
    const m = (a.getAttribute('href') || '').match(/\/status\/(\d+)/);
    if (m) return m[1];
  }
  return '';
}

export function extractQuotedTweet(article: Element): TweetNode | undefined {
  const container = quotedTweetContainer(article);
  if (!container) return undefined;

  const tweetTextEls = article.querySelectorAll(SELECTORS.tweetText);
  const quoteTextEl = tweetTextEls[1]; // may be undefined for article quotes

  const author = stripHandlePrefix(extractAuthorFromArticle(container));
  const date = extractDateFromArticle(container);
  const tweetId = findStatusIdIn(container);
  const text = quoteTextEl ? extractInline(quoteTextEl, null) : [];
  const articleCard = extractArticleCard(container);
  // For article-card quotes the cover is what we want; don't double-render
  // it as a media item.
  const mediaExclude: Element[] = [];
  if (articleCard) {
    const coverEl = container.querySelector('[data-testid="article-cover-image"]');
    if (coverEl) mediaExclude.push(coverEl);
  }
  const media = extractMedia(container, mediaExclude);

  const node: TweetNode = { type: 'tweet', author, date, tweetId, text, media };
  if (articleCard) node.articleCard = articleCard;
  return node;
}
