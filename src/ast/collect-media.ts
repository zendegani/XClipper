import type { Block, Document, MediaItem, TweetNode } from './types';

export interface CollectedMedia {
  kind: 'image' | 'video' | 'gif';
  url: string;
  posterUrl?: string;
  tweetId?: string;
}

export function collectMedia(doc: Document): CollectedMedia[] {
  const media: CollectedMedia[] = [];

  switch (doc.body.type) {
    case 'tweet':
      collectTweetMedia(doc.body, media);
      break;
    case 'thread':
      for (const tweet of doc.body.tweets) collectTweetMedia(tweet, media);
      break;
    case 'article':
      collectArticleBlocks(doc.body.children, media);
      break;
  }

  return media;
}

export function isDownloadableVideo(media: CollectedMedia): boolean {
  return (media.kind === 'video' || media.kind === 'gif')
    && media.url !== media.posterUrl
    && isProgressiveMp4(media.url);
}

export function isProgressiveMp4(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:'
      && parsed.hostname === 'video.twimg.com'
      && parsed.pathname.toLowerCase().endsWith('.mp4');
  } catch {
    return false;
  }
}

function collectTweetMedia(tweet: TweetNode, out: CollectedMedia[]): void {
  for (const media of tweet.media) out.push(collectedTweetMedia(media, tweet.tweetId));
  if (tweet.quotedTweet) collectTweetMedia(tweet.quotedTweet, out);
}

function collectedTweetMedia(media: MediaItem, tweetId: string): CollectedMedia {
  return {
    kind: media.kind,
    url: media.url,
    ...(media.posterUrl !== undefined ? { posterUrl: media.posterUrl } : {}),
    tweetId,
  };
}

function collectArticleBlocks(blocks: Block[], out: CollectedMedia[]): void {
  for (const block of blocks) collectArticleBlock(block, out);
}

function collectArticleBlock(block: Block, out: CollectedMedia[]): void {
  switch (block.type) {
    case 'tweet':
      collectTweetMedia(block, out);
      return;
    case 'thread':
      for (const tweet of block.tweets) collectTweetMedia(tweet, out);
      return;
    case 'article':
      collectArticleBlocks(block.children, out);
      return;
    case 'image':
      out.push({ kind: 'image', url: block.url });
      return;
    case 'video':
      out.push({
        kind: 'video',
        url: block.sourceUrl,
        ...(block.posterUrl !== undefined ? { posterUrl: block.posterUrl } : {}),
      });
      return;
    case 'list':
      for (const item of block.children) collectArticleBlocks(item.children, out);
      return;
    case 'listItem':
    case 'blockquote':
      collectArticleBlocks(block.children, out);
      return;
    case 'paragraph':
    case 'heading':
    case 'code':
    case 'table':
    case 'poll':
    case 'linkCard':
    case 'articleCard':
    case 'thematicBreak':
      return;
  }
}
