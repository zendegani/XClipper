// Posts X showed only as a preview (issue #184).
//
// On a permalink X cuts every post but the requested one at about 280
// characters, so a thread exported from a later post, the posts a reply
// answers, a quote, or a post embedded in an article can arrive cut off. Single
// export fills those in (content.ts); whatever stays cut off ends with a link
// to the post rather than stopping mid-line.

import type { Block, Document, InlineNode, TweetNode } from './types';

// Every cut-off post in `doc`, as live nodes, so the caller fills them in place.
export function truncatedTweets(doc: Document): TweetNode[] {
  const out: TweetNode[] = [];
  const visitTweet = (tweet: TweetNode): void => {
    if (tweet.truncated) out.push(tweet);
    if (tweet.quotedTweet) visitTweet(tweet.quotedTweet);
  };
  const visitBlocks = (blocks: Block[]): void => {
    for (const block of blocks) {
      if (block.type === 'tweet') visitTweet(block);
      else if (block.type === 'thread') block.tweets.forEach(visitTweet);
      else if (
        block.type === 'article' || block.type === 'list' ||
        block.type === 'listItem' || block.type === 'blockquote'
      ) {
        visitBlocks(block.children);
      }
    }
  };
  doc.context?.forEach(visitTweet);
  visitBlocks([doc.body]);
  return out;
}

// The text renderers show: a cut-off post ends with "…" and a link to its own
// page, where X shows all of it.
export function displayText(tweet: TweetNode): InlineNode[] {
  if (!tweet.truncated) return tweet.text;
  if (!tweet.tweetId) return [...tweet.text, { type: 'text', value: '…' }];
  return [
    ...tweet.text,
    { type: 'text', value: '… ' },
    {
      type: 'link',
      url: `https://x.com/${tweet.author.handle}/status/${tweet.tweetId}`,
      children: [{ type: 'text', value: 'Show more' }],
    },
  ];
}
