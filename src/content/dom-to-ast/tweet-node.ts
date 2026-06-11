import type { TweetNode } from '../../ast/types';
import { SELECTORS, extractAuthorFromArticle, getTweetStatusId } from '../dom';
import { extractEngagementMetadata } from '../tweet';
import { stripHandlePrefix, extractDateFromArticle } from './shared';
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
  return node;
}
