import type {
  Document,
  TweetNode,
  MediaItem,
  AuthorInfo,
  InlineNode,
} from '../ast/types';
import {
  SELECTORS,
  extractAuthorFromArticle,
  extractTweetId,
  isArticlePage,
} from './dom';
import { extractEngagementMetadata } from './tweet';

// DOM → Content AST. v1 starter handles a single tweet with media only.
// Unsupported branches throw rather than silently emitting wrong-shape AST;
// coverage grows fixture-by-fixture.
export function domToAst(): Document {
  if (!window.location.pathname.includes('/status/')) {
    throw new Error('domToAst: not on an X.com status page');
  }
  if (isArticlePage()) {
    throw new Error('domToAst: article extraction not yet implemented');
  }

  const article = document.querySelector('article[role="article"]');
  if (!article) {
    throw new Error('domToAst: no <article> found');
  }

  const author = stripHandlePrefix(extractAuthorFromArticle(article));
  const date = extractDateFromArticle(article);
  const tweetId = extractTweetId();
  const sourceUrl = `https://x.com${window.location.pathname.replace(/\/$/, '')}`;
  const engagement = extractEngagementMetadata(article);

  const tweet: TweetNode = {
    type: 'tweet',
    author,
    date,
    tweetId,
    text: extractTweetText(article),
    media: extractMedia(article),
  };
  if (engagement) tweet.engagement = engagement;

  return {
    version: 1,
    metadata: {
      type: 'tweet',
      sourceUrl,
      tweetId,
      author,
      date,
      ...(engagement ? { engagement } : {}),
    },
    body: tweet,
  };
}

function stripHandlePrefix(a: { name: string; handle: string }): AuthorInfo {
  return {
    name: a.name,
    handle: a.handle.startsWith('@') ? a.handle.slice(1) : a.handle,
  };
}

function extractDateFromArticle(article: Element): string {
  const timeEl = article.querySelector('time');
  if (timeEl) {
    const datetime = timeEl.getAttribute('datetime');
    if (datetime) return datetime;
    return timeEl.textContent?.trim() || '';
  }
  return new Date().toISOString();
}

function extractTweetText(article: Element): InlineNode[] {
  const tweetTextEls = article.querySelectorAll(SELECTORS.tweetText);
  if (tweetTextEls.length === 0) return [];
  const first = tweetTextEls[0];
  const text = first.textContent?.trim() || '';
  if (!text) return [];
  throw new Error('domToAst: tweet body text not yet implemented');
}

function extractMedia(scope: Element): MediaItem[] {
  const out: MediaItem[] = [];

  const videos = Array.from(scope.querySelectorAll('video'));
  for (const video of videos) {
    const poster = video.getAttribute('poster');
    if (!poster) continue;
    // X serves video via MSE; the <source> src is a blob: URL that expires
    // with the session, so it's useless for archival. Until a stable
    // playable-URL strategy lands, both url and posterUrl point at the
    // poster image — the only stable asset we have for this video.
    out.push({ kind: 'video', url: poster, posterUrl: poster });
  }

  const videoPosters = new Set(
    videos.map((v) => v.getAttribute('poster')).filter((p): p is string => !!p)
  );
  const photoImgs = scope.querySelectorAll(`${SELECTORS.tweetPhoto} img`);
  for (const img of photoImgs) {
    const src = (img as HTMLImageElement).src;
    if (!src) continue;
    if (src.includes('emoji') || src.includes('profile_images')) continue;
    if (videoPosters.has(src)) continue;
    throw new Error('domToAst: photo media not yet implemented');
  }

  return out;
}
