// Fill in the MP4 URLs the DOM never exposes.
//
// X plays video through MSE, so a DOM-extracted video node carries only its
// poster: `url === posterUrl`, which is exactly what isDownloadableVideo and
// renderMediaItem test for before treating a node as a real video. The variant
// list lives only in X's GraphQL payload, so the single-export path resolves it
// separately and applies it here, keyed by poster.
//
// Matching is on the poster's path rather than its full URL: the DOM and the
// GraphQL payload agree on the media key in the path but not always on the
// query string (`?format=jpg&name=small`). A node whose poster isn't in the map
// is left exactly as it was, so an unresolved video degrades to the thumbnail
// it renders today rather than breaking the export.

import type { Block, Document, MediaItem, TweetNode } from './types';

export function posterKey(url: string): string | null {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
}

// Mutates `doc` in place — it is a fresh structure deserialized off the message
// boundary, never shared state. Returns how many nodes were filled in.
export function applyVideoUrls(doc: Document, mp4ByPoster: Map<string, string>): number {
  if (mp4ByPoster.size === 0) return 0;
  const state = { applied: 0 };

  switch (doc.body.type) {
    case 'tweet':
      applyToTweet(doc.body, mp4ByPoster, state);
      break;
    case 'thread':
      for (const tweet of doc.body.tweets) applyToTweet(tweet, mp4ByPoster, state);
      break;
    case 'article':
      applyToBlocks(doc.body.children, mp4ByPoster, state);
      break;
  }

  return state.applied;
}

interface State {
  applied: number;
}

function lookup(poster: string | undefined, map: Map<string, string>): string | undefined {
  if (!poster) return undefined;
  const key = posterKey(poster);
  return key ? map.get(key) : undefined;
}

function applyToMedia(media: MediaItem, map: Map<string, string>, state: State): void {
  if (media.kind !== 'video' && media.kind !== 'gif') return;
  // Already carries a real source (Fast Batch built this node) — leave it.
  if (media.url !== media.posterUrl) return;
  const mp4 = lookup(media.posterUrl, map);
  if (!mp4) return;
  media.url = mp4;
  state.applied++;
}

function applyToTweet(tweet: TweetNode, map: Map<string, string>, state: State): void {
  for (const media of tweet.media) applyToMedia(media, map, state);
  if (tweet.quotedTweet) applyToTweet(tweet.quotedTweet, map, state);
}

function applyToBlocks(blocks: Block[], map: Map<string, string>, state: State): void {
  for (const block of blocks) applyToBlock(block, map, state);
}

function applyToBlock(block: Block, map: Map<string, string>, state: State): void {
  switch (block.type) {
    case 'tweet':
      applyToTweet(block, map, state);
      return;
    case 'thread':
      for (const tweet of block.tweets) applyToTweet(tweet, map, state);
      return;
    case 'article':
      applyToBlocks(block.children, map, state);
      return;
    case 'video': {
      if (block.sourceUrl !== block.posterUrl) return;
      const mp4 = lookup(block.posterUrl, map);
      if (!mp4) return;
      block.sourceUrl = mp4;
      state.applied++;
      return;
    }
    case 'list':
      for (const item of block.children) applyToBlocks(item.children, map, state);
      return;
    case 'listItem':
    case 'blockquote':
      applyToBlocks(block.children, map, state);
      return;
    case 'image':
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
