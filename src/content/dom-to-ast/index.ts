import type { Document, TweetNode, ThreadNode } from '../../ast/types';
import {
  extractAuthorFromArticle,
  extractTweetId,
  getTweetStatusId,
  isArticlePage,
} from '../dom';
import { extractEngagementMetadata, isPromotedArticle } from '../tweet';
import { stripHandlePrefix, extractDateFromArticle } from './shared';
import { articleToTweetNode } from './tweet-node';
import { articleDocument } from './article-body';

// DOM → Content AST. v1 covers single tweets, threads (same-author runs),
// optional quote tweets, image/video media, polls, link cards, and X-Notes
// articles. Unsupported branches throw; coverage grows fixture-by-fixture.
export function domToAst(opts: { singleTweet?: boolean } = {}): Document {
  if (!window.location.pathname.includes('/status/')) {
    throw new Error('domToAst: not on an X.com status page');
  }
  if (isArticlePage()) {
    return articleDocument();
  }

  const allArticles = Array.from(document.querySelectorAll('article[role="article"]'))
    .filter((a) => !isPromotedArticle(a));
  if (allArticles.length === 0) {
    throw new Error('domToAst: no <article> found');
  }
  // Rehydrated articles (from tweet.ts → rehydrateMissingArticles) carry
  // thread order in their host's child order. Pin them ahead of the live
  // cells while keeping each group's relative order (Array.sort is stable
  // in modern V8). Tweet-id sorting was tempting but breaks here: replies
  // can have ids that fall *between* thread tweet ids (e.g. trq212's
  // "thank you!" reply was Mar 21, between thread tweets posted Mar 21
  // and Mar 22+), so an id sort interleaves them and the boundary break
  // stops mid-thread.
  allArticles.sort((a, b) => {
    const aR = a.closest('[data-xclipper-rehydrate-host]') ? 0 : 1;
    const bR = b.closest('[data-xclipper-rehydrate-host]') ? 0 : 1;
    return aR - bR;
  });

  const rootAuthor = stripHandlePrefix(extractAuthorFromArticle(allArticles[0]));
  const threadArticles = opts.singleTweet
    ? [focusedArticle(allArticles)]
    : collectSameAuthorArticles(allArticles, rootAuthor.handle);

  const tweetId = extractTweetId();
  const sourceUrl = `https://x.com${window.location.pathname.replace(/\/$/, '')}`;
  const engagement = extractEngagementMetadata(threadArticles[0]);
  const rootDate = extractDateFromArticle(threadArticles[0]);

  const tweets = threadArticles.map((a) => articleToTweetNode(a));
  const isThread = tweets.length > 1;

  const body: TweetNode | ThreadNode = isThread
    ? { type: 'thread', tweets }
    : tweets[0];

  return {
    version: 1,
    metadata: {
      type: isThread ? 'thread' : 'tweet',
      sourceUrl,
      tweetId,
      author: rootAuthor,
      date: rootDate,
      ...(engagement ? { engagement } : {}),
    },
    body,
  };
}

function focusedArticle(articles: Element[]): Element {
  const tweetId = extractTweetId();
  return articles.find((a) => getTweetStatusId(a) === tweetId) || articles[0];
}

function collectSameAuthorArticles(articles: Element[], rootHandle: string): Element[] {
  const seen = new Set<string>();
  const out: Element[] = [];
  const target = rootHandle.toLowerCase();
  for (const article of articles) {
    const a = extractAuthorFromArticle(article);
    const handle = (a.handle.startsWith('@') ? a.handle.slice(1) : a.handle).toLowerCase();
    // Tombstones (hidden / deleted replies) resolve to "unknown" — skip but
    // don't treat them as the reply boundary.
    if (handle === 'unknown') continue;
    if (handle !== target) break;
    const sid = getTweetStatusId(article);
    if (seen.has(sid)) continue;
    seen.add(sid);
    out.push(article);
  }
  return out;
}
