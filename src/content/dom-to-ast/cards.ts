import type { LinkCardNode, ArticleCardNode } from '../../ast/types';
import { hostMatches } from '../../shared/media';

// ─── Link card (OG preview) ─────────────────────────────────────────

export function extractLinkCard(article: Element): LinkCardNode | undefined {
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

// ─── Article card (X long-form preview) ────────────────────────────
//
// X article cards appear in two places:
//   1. Tweet quote position — wrapped in div[role="link"], beside an
//      avatar + author header. quotedTweetContainer() picks them up via
//      the fallback path below (an article quote has no tweetText).
//   2. Inline in an article body (`twitterArticleRichTextView`) — sits as
//      a sibling block among paragraphs. articleBlockToNodes() emits it.
//
// In both cases the distinguishing DOM hook is data-testid="article-cover-image",
// with a sibling "Article" badge + title span + description div.
export function extractArticleCard(scope: Element): ArticleCardNode | undefined {
  const coverEl = scope.querySelector('[data-testid="article-cover-image"]');
  if (!coverEl) return undefined;

  // Title + description live in the two text divs that follow the cover.
  // Walk siblings of the cover's parent to find them — works for both the
  // quote-position layout and the article-body layout, even though their
  // wrapping divs differ slightly.
  const cardRoot = coverEl.parentElement?.parentElement || coverEl.parentElement;
  let title = '';
  let description = '';
  if (cardRoot) {
    const textDivs = cardRoot.querySelectorAll('div[dir="auto"]');
    for (const d of textDivs) {
      const t = d.textContent?.trim() || '';
      if (!t) continue;
      // Skip the "Article" badge text — it always equals "Article" exactly.
      if (t === 'Article') continue;
      if (!title) title = t;
      else if (!description) description = t;
    }
  }
  if (!title) return undefined;

  // Image: prefer the <img src>; fall back to the background-image URL.
  let imageUrl: string | undefined;
  const imgEl = coverEl.querySelector('img') as HTMLImageElement | null;
  if (imgEl?.src) imageUrl = imgEl.src;
  else {
    const bg = coverEl.querySelector('[style*="background-image"]') as HTMLElement | null;
    const m = bg?.getAttribute('style')?.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/);
    if (m) imageUrl = m[1];
  }
  if (imageUrl && hostMatches(imageUrl, 'pbs.twimg.com')) {
    imageUrl = imageUrl.replace(/&name=\w+/, '&name=large');
  }

  // URL: X article quotes wrap in a div[role="link"] without a real href.
  // If a real <a href> exists in the card we honor it; otherwise leave url
  // unset and the renderer omits the link wrapper.
  let url: string | undefined;
  const anchor = scope.querySelector('a[href]') as HTMLAnchorElement | null;
  if (anchor?.href && /\/article\//.test(anchor.href)) url = anchor.href;

  const node: ArticleCardNode = { type: 'articleCard', title };
  if (description) node.description = description;
  if (imageUrl) node.imageUrl = imageUrl;
  if (url) node.url = url;
  return node;
}

export function linkCardContainer(article: Element): Element | null {
  const wrapper = article.querySelector('[data-testid="card.wrapper"]');
  if (!wrapper) return null;
  if (wrapper.querySelector('[data-testid="cardPoll"]')) return null;
  return wrapper;
}
