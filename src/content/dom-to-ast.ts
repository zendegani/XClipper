import type {
  Document,
  TweetNode,
  ThreadNode,
  MediaItem,
  AuthorInfo,
  InlineNode,
  EntityNode,
  LinkNode,
  PollNode,
  PollChoice,
} from '../ast/types';
import {
  SELECTORS,
  extractAuthorFromArticle,
  extractTweetId,
  getTweetStatusId,
  isArticlePage,
} from './dom';
import { extractEngagementMetadata, isPromotedArticle } from './tweet';
import { hostMatches } from '../shared/media';

// DOM → Content AST. v1 covers single tweets, threads (same-author runs),
// optional quote tweets, and image/video media. Article extraction, polls,
// and link cards still throw; coverage grows fixture-by-fixture.
export function domToAst(): Document {
  if (!window.location.pathname.includes('/status/')) {
    throw new Error('domToAst: not on an X.com status page');
  }
  if (isArticlePage()) {
    throw new Error('domToAst: article extraction not yet implemented');
  }

  const allArticles = Array.from(document.querySelectorAll('article[role="article"]'))
    .filter((a) => !isPromotedArticle(a));
  if (allArticles.length === 0) {
    throw new Error('domToAst: no <article> found');
  }

  const rootAuthor = stripHandlePrefix(extractAuthorFromArticle(allArticles[0]));
  const threadArticles = collectSameAuthorArticles(allArticles, rootAuthor.handle);

  const tweetId = extractTweetId();
  const sourceUrl = `https://x.com${window.location.pathname.replace(/\/$/, '')}`;
  const engagement = extractEngagementMetadata(allArticles[0]);
  const rootDate = extractDateFromArticle(allArticles[0]);

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

function articleToTweetNode(article: Element): TweetNode {
  const author = stripHandlePrefix(extractAuthorFromArticle(article));
  const date = extractDateFromArticle(article);
  const tweetId = getTweetStatusId(article);
  const engagement = extractEngagementMetadata(article);
  const quotedTweet = extractQuotedTweet(article);
  const quoteContainer = quotedTweetContainer(article);
  const tweetTextEls = article.querySelectorAll(SELECTORS.tweetText);
  const mainTextEl = tweetTextEls[0];
  const text = mainTextEl ? extractInline(mainTextEl, quoteContainer) : [];
  const excludeContainers = quoteContainer ? [quoteContainer] : [];
  const media = extractMedia(article, excludeContainers);

  const node: TweetNode = { type: 'tweet', author, date, tweetId, text, media };
  const poll = extractPoll(article);
  if (poll) node.poll = poll;
  if (engagement) node.engagement = engagement;
  if (quotedTweet) node.quotedTweet = quotedTweet;
  return node;
}

// ─── Poll ───────────────────────────────────────────────────────────

function extractPoll(article: Element): PollNode | undefined {
  const pollEl = article.querySelector('[data-testid="cardPoll"]');
  if (!pollEl) return undefined;

  const choices: PollChoice[] = [];
  for (const choice of pollEl.querySelectorAll('li[role="listitem"], [role="radio"]')) {
    let percent: number | undefined;
    for (const el of choice.querySelectorAll('span, div')) {
      const t = (el.textContent || '').trim();
      const m = t.match(/^(\d+(?:\.\d+)?)%$/);
      if (m) {
        percent = Number(m[1]);
        break;
      }
    }
    let label = (choice.textContent || '').replace(/\s+/g, ' ').trim();
    if (percent !== undefined && label.endsWith(`${percent}%`)) {
      label = label.slice(0, label.length - `${percent}%`.length).trim();
    }
    if (!label) continue;
    choices.push(percent === undefined ? { label } : { label, percent });
  }
  if (choices.length === 0) return undefined;

  // Footer: drop the choices and the radiogroup's notice, then read remaining
  // text — typically "N votes · <status>".
  const clone = pollEl.cloneNode(true) as Element;
  clone.querySelectorAll('ul, [role="radiogroup"]').forEach((el) => el.remove());
  const noticeId = pollEl.querySelector('[role="radiogroup"]')?.getAttribute('aria-describedby');
  if (noticeId) clone.querySelector(`[id="${noticeId}"]`)?.remove();
  const footer = (clone.textContent || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*·\s*/g, ' · ')
    .trim();

  return footer ? { type: 'poll', choices, footer } : { type: 'poll', choices };
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

function extractInline(textEl: Element, quoteContainer: Element | null): InlineNode[] {
  const out: InlineNode[] = [];
  for (const child of textEl.childNodes) {
    walkInline(child, quoteContainer, out);
  }
  return collapseEdges(trimAroundBreaks(mergeAdjacentText(out)));
}

function walkInline(node: Node, quoteContainer: Element | null, out: InlineNode[]): void {
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
  if (tag === 'A') {
    const inline = anchorToInline(el);
    if (inline) {
      out.push(inline);
      return;
    }
    // Unrecognised link shape — treat as transparent and walk children.
  }
  for (const child of el.childNodes) {
    walkInline(child, quoteContainer, out);
  }
}

function anchorToInline(a: Element): EntityNode | LinkNode | null {
  const href = a.getAttribute('href') || '';
  const text = (a.textContent || '').trim();
  if (!href) return null;

  // Mention: /handle (relative, no further path)
  const mention = href.match(/^\/([A-Za-z0-9_]+)$/);
  if (mention && text.startsWith('@')) {
    return {
      type: 'entity',
      kind: 'mention',
      value: mention[1],
      url: `https://x.com${href}`,
    };
  }

  // Hashtag: /hashtag/<tag>?src=…
  const hashtag = href.match(/^\/hashtag\/([^/?#]+)/);
  if (hashtag && text.startsWith('#')) {
    return {
      type: 'entity',
      kind: 'hashtag',
      value: decodeURIComponent(hashtag[1]),
      url: `https://x.com${href.split('?')[0]}`,
    };
  }

  // Cashtag: text starts with $; href is /search?q=%24SYM or similar
  if (/^\$[A-Z]+$/.test(text)) {
    return {
      type: 'entity',
      kind: 'cashtag',
      value: text.slice(1),
      url: href.startsWith('/') ? `https://x.com${href}` : href,
    };
  }

  // External link
  const children: InlineNode[] = [];
  for (const child of a.childNodes) {
    walkInline(child, null, children);
  }
  return {
    type: 'link',
    url: resolveExternalUrl(href, text),
    children: mergeAdjacentText(children),
  };
}

// X wraps external links in t.co; the visible label is the display URL. When
// the display text looks like a URL, prefer it over the t.co wrapper. When
// it doesn't (or no recognisable form), keep the href as-is.
function resolveExternalUrl(href: string, text: string): string {
  const isTco = /^https?:\/\/t\.co\//.test(href);
  if (isTco) {
    if (/^https?:\/\//.test(text)) return text;
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(text)) return `https://${text}`;
  }
  return href;
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

  return { type: 'tweet', author, date, tweetId, text, media };
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
    out.push({ kind: 'video', url: poster, posterUrl: poster });
  }

  const videoPosters = new Set(
    videos.map((v) => v.getAttribute('poster')).filter((p): p is string => !!p)
  );
  const photoImgs = Array.from(scope.querySelectorAll(`${SELECTORS.tweetPhoto} img`))
    .filter((img) => !inExcluded(img));
  for (const img of photoImgs) {
    let src = (img as HTMLImageElement).src;
    if (!src) continue;
    if (src.includes('emoji') || src.includes('profile_images')) continue;
    if (videoPosters.has(src)) continue;
    if (hostMatches(src, 'pbs.twimg.com')) {
      src = src.replace(/&name=\w+/, '&name=large');
    }
    const alt = img.getAttribute('alt') || undefined;
    out.push({ kind: 'image', url: src, ...(alt ? { alt } : {}) });
  }

  return out;
}
