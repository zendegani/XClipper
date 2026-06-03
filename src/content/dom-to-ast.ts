import type {
  Document,
  TweetNode,
  ThreadNode,
  ArticleNode,
  Block,
  MediaItem,
  AuthorInfo,
  InlineNode,
  EntityNode,
  LinkNode,
  PollNode,
  PollChoice,
  LinkCardNode,
  ImageNode,
  HeadingNode,
  ListNode,
  ListItemNode,
  CodeBlockNode,
  ParagraphNode,
  ThematicBreakNode,
} from '../ast/types';
import {
  SELECTORS,
  extractAuthor,
  extractAuthorFromArticle,
  extractDate,
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
    return articleDocument();
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

// ─── Link card (OG preview) ─────────────────────────────────────────

function extractLinkCard(article: Element): LinkCardNode | undefined {
  const wrapper = article.querySelector('[data-testid="card.wrapper"]');
  if (!wrapper) return undefined;
  if (wrapper.querySelector('[data-testid="cardPoll"]')) return undefined;

  const cardLink = wrapper.querySelector('a[href]');
  const href = cardLink?.getAttribute('href') || '';

  const detail = wrapper.querySelector(
    '[data-testid="card.layoutSmall.detail"], [data-testid="card.layoutLarge.detail"]'
  );
  const mediaBlock = wrapper.querySelector(
    '[data-testid="card.layoutSmall.media"], [data-testid="card.layoutLarge.media"]'
  );

  let domain = '';
  let title = '';
  let description = '';

  if (detail) {
    const detailDivs = detail.querySelectorAll('div[dir="auto"]');
    for (const d of detailDivs) {
      const t = d.textContent?.trim() || '';
      if (!t) continue;
      if (!domain) domain = t;
      else if (!title) title = t;
      else if (!description) description = t;
    }
  } else {
    // Media-only card: title overlays the image; domain comes from the URL.
    const overlay = mediaBlock?.querySelector('div[dir="ltr"], div[dir="auto"]');
    title = overlay?.textContent?.trim() || '';
    if (href) {
      try {
        domain = new URL(href).hostname.replace(/^www\./, '');
      } catch { /* leave domain empty */ }
    }
  }

  if (!title) return undefined;

  let imageUrl: string | undefined;
  const previewImg = mediaBlock?.querySelector('img') as HTMLImageElement | null;
  if (previewImg?.src) {
    let src = previewImg.src;
    if (hostMatches(src, 'pbs.twimg.com')) {
      src = src.replace(/&name=\w+/, '&name=large');
    }
    imageUrl = src;
  }

  const node: LinkCardNode = { type: 'linkCard', url: href, title };
  if (description) node.description = description;
  if (imageUrl) node.imageUrl = imageUrl;
  if (domain) node.domain = domain;
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

// ─── Article ────────────────────────────────────────────────────────

function articleDocument(): Document {
  const author = stripHandlePrefix(extractAuthor());
  const date = extractDate();
  const tweetId = extractTweetId();
  const sourceUrl = `https://x.com${window.location.pathname.replace(/\/$/, '')}`;
  const engagement = extractEngagementMetadata(document);

  const titleEl = document.querySelector(SELECTORS.articleTitle);
  const title = titleEl?.textContent?.trim() || undefined;

  const banner = extractArticleBanner();
  const children = extractArticleBlocks();

  const articleNode: ArticleNode = { type: 'article', children };
  if (banner) articleNode.banner = banner;

  return {
    version: 1,
    metadata: {
      type: 'article',
      sourceUrl,
      tweetId,
      author,
      date,
      ...(title ? { title } : {}),
      ...(engagement ? { engagement } : {}),
    },
    body: articleNode,
  };
}

function extractArticleBanner(): ImageNode | undefined {
  const articleEl = document.querySelector('article[role="article"]');
  if (!articleEl) return undefined;
  const heroImg = articleEl.querySelector(`${SELECTORS.tweetPhoto} img`)
    || articleEl.querySelector('[data-testid="card.layoutLarge.media"] img');
  if (!heroImg) return undefined;
  let src = (heroImg as HTMLImageElement).src || '';
  if (!src) return undefined;
  if (src.includes('emoji') || src.includes('profile_images') || src.includes('hashflags')) {
    return undefined;
  }
  if (hostMatches(src, 'pbs.twimg.com')) {
    src = src.replace(/&name=\w+/, '&name=large');
  }
  return { type: 'image', url: src };
}

function extractArticleBlocks(): Block[] {
  const richTextView = document.querySelector(SELECTORS.articleRichText);
  if (!richTextView) {
    throw new Error('domToAst: article rich-text view missing');
  }
  const draftContent = richTextView.querySelector(SELECTORS.articleDraftContent) || richTextView;
  const dataContents = draftContent.querySelector('[data-contents]') || draftContent;

  const out: Block[] = [];
  for (const block of Array.from(dataContents.children)) {
    const nodes = articleBlockToNodes(block as HTMLElement);
    out.push(...nodes);
  }
  return out;
}

function articleBlockToNodes(block: HTMLElement): Block[] {
  // Code block — must check before separator (both use <section>).
  const codeBlock = block.querySelector('[data-testid="markdown-code-block"]')
    || (block.getAttribute('data-testid') === 'markdown-code-block' ? block : null);
  if (codeBlock) {
    const codeEl = codeBlock.querySelector('code');
    const langFromClass = codeEl?.className?.match(/language-(\w+)/)?.[1] || '';
    const langLabel = codeBlock.querySelector('[class*="r-1aiqnjv"]');
    const lang = langFromClass || langLabel?.textContent?.trim() || '';
    const preEl = codeBlock.querySelector('pre');
    const codeSource = preEl?.querySelector('code') || preEl;
    const value = (codeSource?.textContent || '').replace(/\s+$/, '');
    const node: CodeBlockNode = { type: 'code', value };
    if (lang) node.lang = lang;
    return [node];
  }

  if (block.querySelector('[role="separator"]')) {
    return [{ type: 'thematicBreak' } satisfies ThematicBreakNode];
  }

  const hasH1 = block.classList.contains('longform-header-one')
    || !!block.querySelector('.longform-header-one');
  if (hasH1) {
    const text = block.textContent?.trim() || '';
    if (!text) return [];
    const node: HeadingNode = { type: 'heading', depth: 1, children: [{ type: 'text', value: text }] };
    return [node];
  }

  const hasH2 = block.classList.contains('longform-header-two')
    || !!block.querySelector('.longform-header-two');
  if (hasH2) {
    const text = block.textContent?.trim() || '';
    if (!text) return [];
    const node: HeadingNode = { type: 'heading', depth: 2, children: [{ type: 'text', value: text }] };
    return [node];
  }

  if (block.tagName === 'UL') {
    const items: ListItemNode[] = [];
    for (const li of block.querySelectorAll('.longform-unordered-list-item')) {
      const inline = extractArticleInline(li);
      if (inline.length === 0) continue;
      items.push({ type: 'listItem', children: [{ type: 'paragraph', children: inline }] });
    }
    return items.length > 0 ? [{ type: 'list', ordered: false, children: items } satisfies ListNode] : [];
  }

  if (block.classList.contains('longform-unordered-list-item')) {
    const inline = extractArticleInline(block);
    if (inline.length === 0) return [];
    return [{
      type: 'list',
      ordered: false,
      children: [{ type: 'listItem', children: [{ type: 'paragraph', children: inline }] }],
    } satisfies ListNode];
  }

  if (block.tagName === 'OL') {
    const items: ListItemNode[] = [];
    for (const li of block.querySelectorAll('li')) {
      const inline = extractArticleInline(li);
      if (inline.length === 0) continue;
      items.push({ type: 'listItem', children: [{ type: 'paragraph', children: inline }] });
    }
    return items.length > 0 ? [{ type: 'list', ordered: true, children: items } satisfies ListNode] : [];
  }

  // Embedded simpleTweet card — match legacy behavior by emitting just the
  // inner avatar image. The card surfaces author + handle + snippet inline,
  // but the user-facing fixture has historically rendered only the avatar.
  if (block.querySelector('[data-testid="simpleTweet"]')) {
    const img = findArticleBlockImage(block);
    return img ? [img] : [];
  }

  // Image-only paragraph — emit ImageNode rather than wrapping in paragraph.
  const img = findArticleBlockImage(block);
  if (img && blockHasOnlyImage(block)) {
    return [img];
  }

  const inline = extractArticleInline(block);
  if (inline.length === 0) return [];
  return [{ type: 'paragraph', children: inline } satisfies ParagraphNode];
}

function blockHasOnlyImage(block: HTMLElement): boolean {
  // True when every text node under the block is whitespace and the only
  // meaningful descendant is a non-emoji <img>.
  return (block.textContent || '').trim() === '' && !!block.querySelector('img');
}

function findArticleBlockImage(block: HTMLElement): ImageNode | undefined {
  const imgEl = block.querySelector('img') as HTMLImageElement | null;
  if (!imgEl) return undefined;
  let src = imgEl.src || '';
  if (!src) return undefined;
  if (src.includes('twimg.com/emoji') || hostMatches(src, 'abs-0.twimg.com') || /\.svg($|\?)/.test(src)) {
    return undefined;
  }
  if (hostMatches(src, 'pbs.twimg.com')) {
    src = src.replace(/&name=\w+/, '&name=large');
  }
  const alt = imgEl.getAttribute('alt') || undefined;
  return { type: 'image', url: src, ...(alt ? { alt } : {}) };
}

function extractArticleInline(el: Element): InlineNode[] {
  // Article inline reuses the tweet walker but accepts a wider set of <a>
  // hrefs (mentions can use /@handle) and emits <strong>/<em>.
  const out: InlineNode[] = [];
  for (const child of el.childNodes) {
    walkInline(child, null, out);
  }
  return collapseEdges(trimAroundBreaks(mergeAdjacentText(out)));
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
  // Draft.js uses inline styles for bold/italic; tweets occasionally use <b>/<em>.
  const html = el as HTMLElement;
  const isStrong = tag === 'STRONG' || tag === 'B' || html.style?.fontWeight === 'bold';
  const isEm = tag === 'EM' || tag === 'I' || html.style?.fontStyle === 'italic';
  if (isStrong) {
    const children: InlineNode[] = [];
    for (const c of el.childNodes) walkInline(c, quoteContainer, children);
    const merged = mergeAdjacentText(children);
    if (merged.length > 0) out.push({ type: 'strong', children: merged });
    return;
  }
  if (isEm) {
    const children: InlineNode[] = [];
    for (const c of el.childNodes) walkInline(c, quoteContainer, children);
    const merged = mergeAdjacentText(children);
    if (merged.length > 0) out.push({ type: 'emphasis', children: merged });
    return;
  }
  for (const child of el.childNodes) {
    walkInline(child, quoteContainer, out);
  }
}

function anchorToInline(a: Element): EntityNode | LinkNode | null {
  const href = a.getAttribute('href') || '';
  const text = (a.textContent || '').trim();
  if (!href) return null;

  // Normalize x.com hrefs (absolute or relative) to their path component.
  const xPath = xComPath(href);

  // Mention: /handle or /@handle on x.com
  if (xPath) {
    const mention = xPath.match(/^\/@?([A-Za-z0-9_]+)$/);
    if (mention && text.startsWith('@')) {
      return {
        type: 'entity',
        kind: 'mention',
        value: mention[1],
        url: `https://x.com/${mention[1]}`,
      };
    }
    const hashtag = xPath.match(/^\/hashtag\/([^/?#]+)/);
    if (hashtag && text.startsWith('#')) {
      return {
        type: 'entity',
        kind: 'hashtag',
        value: decodeURIComponent(hashtag[1]),
        url: `https://x.com${xPath.split('?')[0]}`,
      };
    }
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

function xComPath(href: string): string | null {
  if (href.startsWith('/')) return href;
  const m = href.match(/^https?:\/\/(?:www\.|m\.)?x\.com(\/.*)$/);
  return m ? m[1] : null;
}

// X wraps external links in t.co; the visible label is the display URL. When
// the display text looks like a URL, prefer it over the t.co wrapper. When
// it doesn't (or no recognisable form), keep the href as-is.
function resolveExternalUrl(href: string, text: string): string {
  // Protocol-relative → https.
  if (href.startsWith('//')) return `https:${href}`;
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

function linkCardContainer(article: Element): Element | null {
  const wrapper = article.querySelector('[data-testid="card.wrapper"]');
  if (!wrapper) return null;
  if (wrapper.querySelector('[data-testid="cardPoll"]')) return null;
  return wrapper;
}

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
