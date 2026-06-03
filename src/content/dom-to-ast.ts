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

// DOM → Content AST. v1 covers a single tweet with optional media and an
// optional quote tweet. Unsupported branches throw rather than silently
// emitting wrong-shape AST; coverage grows fixture-by-fixture.
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

  const quotedTweet = extractQuotedTweet(article);
  const tweetTextEls = article.querySelectorAll(SELECTORS.tweetText);
  const mainTextEl = tweetTextEls[0];
  const text = mainTextEl ? extractInline(mainTextEl, quotedTweetContainer(article)) : [];
  const excludeContainers = quoteContainersIn(article);
  const media = extractMedia(article, excludeContainers);

  const tweet: TweetNode = {
    type: 'tweet',
    author,
    date,
    tweetId,
    text,
    media,
  };
  if (engagement) tweet.engagement = engagement;
  if (quotedTweet) tweet.quotedTweet = quotedTweet;

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
  return '';
}

// ─── Inline walker ──────────────────────────────────────────────────
// v1 emits TextNode and BreakNode. <a>/<span> are transparent containers.
// LinkNode, EntityNode, EmphasisNode, StrongNode, InlineCodeNode will land
// when a fixture forces them.

function extractInline(textEl: Element, quoteContainer: Element | null): InlineNode[] {
  const out: InlineNode[] = [];
  for (const child of textEl.childNodes) {
    walkInline(child, quoteContainer, out);
  }
  return collapseEdges(trimAroundBreaks(mergeAdjacentText(out)));
}

function mergeAdjacentText(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (n.type === 'text' && prev?.type === 'text') {
      out[out.length - 1] = { type: 'text', value: prev.value + n.value };
    } else {
      out.push(n);
    }
  }
  return out;
}

function trimAroundBreaks(nodes: InlineNode[]): InlineNode[] {
  return nodes.map((n, i) => {
    if (n.type !== 'text') return n;
    let value = n.value;
    if (nodes[i + 1]?.type === 'break') value = value.replace(/[ \t]+$/, '');
    if (nodes[i - 1]?.type === 'break') value = value.replace(/^[ \t]+/, '');
    return { type: 'text', value };
  }).filter((n) => n.type !== 'text' || n.value !== '');
}

function walkInline(node: Node, quoteContainer: Element | null, out: InlineNode[]): void {
  // Skip anything that lives inside the quoted-tweet container — the quote's
  // tweetText is extracted separately.
  if (quoteContainer && node.nodeType === 1 && quoteContainer.contains(node as Element)) {
    return;
  }
  if (node.nodeType === 3) {
    const text = (node as Text).nodeValue || '';
    if (!text) return;
    const parts = text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) out.push({ type: 'break' });
      if (parts[i]) out.push({ type: 'text', value: parts[i] });
    }
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  const tag = el.tagName;
  if (tag === 'BR') {
    out.push({ type: 'break' });
    return;
  }
  if (tag === 'IMG') {
    // X renders emoji as <img alt="🎉">. v1 inlines the alt as text.
    const alt = el.getAttribute('alt');
    if (alt) out.push({ type: 'text', value: alt });
    return;
  }
  for (const child of el.childNodes) {
    walkInline(child, quoteContainer, out);
  }
}

// Drop leading/trailing breaks that come from spacing inside the tweetText
// wrapper rather than from authored content.
function collapseEdges(nodes: InlineNode[]): InlineNode[] {
  let start = 0;
  let end = nodes.length;
  while (start < end && nodes[start].type === 'break') start++;
  while (end > start && nodes[end - 1].type === 'break') end--;
  return nodes.slice(start, end);
}

// ─── Quote tweet ────────────────────────────────────────────────────

function quotedTweetContainer(article: Element): Element | null {
  const tweetTextEls = article.querySelectorAll(SELECTORS.tweetText);
  if (tweetTextEls.length < 2) return null;
  return tweetTextEls[1].closest('div[role="link"]');
}

function quoteContainersIn(article: Element): Element[] {
  const c = quotedTweetContainer(article);
  return c ? [c] : [];
}

// Quote tweets sometimes lack any /status/<id> link in the DOM (X obscures it
// behind a JS handler). Return '' when no navigable id is exposed rather than
// inventing one — downstream consumers can detect the missing id.
function findStatusIdIn(container: Element): string {
  for (const a of container.querySelectorAll('a[href*="/status/"]')) {
    const m = (a.getAttribute('href') || '').match(/\/status\/(\d+)/);
    if (m) return m[1];
  }
  return '';
}

function extractQuotedTweet(article: Element): TweetNode | undefined {
  const container = quotedTweetContainer(article);
  if (!container) return undefined;

  const tweetTextEls = article.querySelectorAll(SELECTORS.tweetText);
  const quoteTextEl = tweetTextEls[1];

  const author = stripHandlePrefix(extractAuthorFromArticle(container));
  const date = extractDateFromArticle(container);
  const tweetId = findStatusIdIn(container);
  const text = extractInline(quoteTextEl, null);
  const media = extractMedia(container, []);

  return {
    type: 'tweet',
    author,
    date,
    tweetId,
    text,
    media,
  };
}

// ─── Media ──────────────────────────────────────────────────────────

function extractMedia(scope: Element, excludeContainers: Element[]): MediaItem[] {
  const inExcluded = (el: Element) =>
    excludeContainers.some((c) => c.contains(el));

  const out: MediaItem[] = [];

  const videos = Array.from(scope.querySelectorAll('video')).filter(
    (v) => !inExcluded(v)
  );
  for (const video of videos) {
    const poster = video.getAttribute('poster');
    if (!poster) continue;
    // X serves video via MSE; the <source> src is a blob: URL that expires
    // with the session. Until a stable playable-URL strategy lands, both
    // url and posterUrl point at the poster — the only stable asset.
    out.push({ kind: 'video', url: poster, posterUrl: poster });
  }

  const videoPosters = new Set(
    videos.map((v) => v.getAttribute('poster')).filter((p): p is string => !!p)
  );
  const photoImgs = Array.from(scope.querySelectorAll(`${SELECTORS.tweetPhoto} img`))
    .filter((img) => !inExcluded(img));
  for (const img of photoImgs) {
    const src = (img as HTMLImageElement).src;
    if (!src) continue;
    if (src.includes('emoji') || src.includes('profile_images')) continue;
    if (videoPosters.has(src)) continue;
    throw new Error('domToAst: photo media not yet implemented');
  }

  return out;
}
