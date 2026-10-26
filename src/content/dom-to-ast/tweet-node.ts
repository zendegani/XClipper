import type { TweetNode } from '../../ast/types';
import { SELECTORS, extractAuthorFromArticle, getTweetStatusId } from '../dom';
import { extractEngagementMetadata } from '../tweet';
import { stripHandlePrefix, extractDateFromArticle, isTextTruncated } from './shared';
import { extractQuotedTweet, quotedTweetContainer } from './quote';
import { extractInline } from './inline';
import { extractLinkCard, linkCardContainer } from './cards';
import { extractMedia } from './media';
import { extractPoll } from './poll';

export function articleToTweetNode(article: Element): TweetNode {
  const author = stripHandlePrefix(extractAuthorFromArticle(article));
  const date = extractDateFromArticle(article);
  const tweetId = getTweetStatusId(article);
  const engagement = extractEngagementMetadata(article);
  const quotedTweet = extractQuotedTweet(article);
  const quoteContainer = quotedTweetContainer(article);
  const tweetTextEls = article.querySelectorAll(SELECTORS.tweetText);
  const mainTextEl = tweetTextEls[0];
  const text = mainTextEl ? extractInline(mainTextEl, quoteContainer) : [];
  const cardContainer = linkCardContainer(article);
  const excludeContainers: Element[] = [];
  if (quoteContainer) excludeContainers.push(quoteContainer);
  if (cardContainer) excludeContainers.push(cardContainer);
  const media = extractMedia(article, excludeContainers);

  const node: TweetNode = { type: 'tweet', author, date, tweetId, text, media };
  const poll = extractPoll(article);
  if (poll) node.poll = poll;
  const linkCard = quotedTweet ? undefined : extractLinkCard(article);
  if (linkCard) node.linkCard = linkCard;
  if (quotedTweet) node.quotedTweet = quotedTweet;
  if (engagement) node.engagement = engagement;
  // A post with no text of its own has the quote's text first, inside the
  // quote card's link wrapper; that cut-off is the quote's, not this post's.
  const card = mainTextEl?.closest('div[role="link"]');
  if (mainTextEl && !(card && article.contains(card)) && isTextTruncated(mainTextEl)) {
    node.truncated = true;
  }
  return node;
}
