import type { Document, TweetNode, ThreadNode } from '../../ast/types';
import {
  extractAuthorFromArticle,
  extractTweetId,
  getTweetStatusId,
  isArticlePage,
  threadRun,
} from '../dom';
import { FOCAL_NOT_FOUND, extractEngagementMetadata, isPromotedArticle } from '../tweet';
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
  // When loadThreadIntoDom ran, its off-screen host holds the whole thread in
  // order, regardless of what X's virtualized timeline still has mounted, so
  // it alone is the source. Mixing in the live page would let a post above
  // the thread (the same author's older post a reply answers) join it.
  const hosted = allArticles.filter((a) => a.closest('[data-xclipper-rehydrate-host]'));
  const articles = hosted.length > 0 ? hosted : allArticles;

  const focal = focusedArticle(articles);
  const run = collectThread(articles, focal);
  const threadArticles = opts.singleTweet ? [focal] : run;
  const rootAuthor = stripHandlePrefix(extractAuthorFromArticle(threadArticles[0]));

  const tweetId = extractTweetId();
  const sourceUrl = `https://x.com${window.location.pathname.replace(/\/$/, '')}`;
  const engagement = extractEngagementMetadata(threadArticles[0]);
  const rootDate = extractDateFromArticle(threadArticles[0]);

  const tweets = threadArticles.map((a) => articleToTweetNode(a));
  const isThread = tweets.length > 1;
  // Every post above the author's thread is what it answers, up to the
  // conversation's first post (issue #154) — even for a single post, whose own
  // thread isn't context. Tombstones have no author to show.
  const context = articles
    .slice(0, articles.indexOf(run[0]))
    .filter((a) => extractAuthorFromArticle(a).handle !== 'unknown')
    .map((a) => articleToTweetNode(a));

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
    ...(context.length > 0 ? { context } : {}),
    body,
  };
}

// Never another post in its place: its date and stats would be exported under
// the requested post's id (issue #182).
function focusedArticle(articles: Element[]): Element {
  const tweetId = extractTweetId();
  const focal = articles.find((a) => getTweetStatusId(a) === tweetId);
  if (!focal) throw new Error(FOCAL_NOT_FOUND);
  return focal;
}

function collectThread(articles: Element[], focal: Element): Element[] {
  const { handle } = extractAuthorFromArticle(focal);
  const { run } = threadRun(articles, handle, (a) => a === focal);
  if (run.length === 0) return [focal]; // a tombstone focal has no author to run on
  const seen = new Set<string>();
  return run.filter((a) => {
    const sid = getTweetStatusId(a);
    if (seen.has(sid)) return false;
    seen.add(sid);
    return true;
  });
}
