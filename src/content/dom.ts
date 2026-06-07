export const SELECTORS = {
  // Article-specific (long-form / Notes)
  articleTitle: '[data-testid="twitter-article-title"]',
  articleRichText: '[data-testid="twitterArticleRichTextView"]',
  articleDraftContent: '[data-testid="longformRichTextComponent"]',
  articleCodeBlock: '[data-testid="markdown-code-block"]',
  // Tweet-specific
  tweetText: '[data-testid="tweetText"]',
  userName: '[data-testid="User-Name"]',
  tweetPhoto: '[data-testid="tweetPhoto"]',
  // Engagement & UI elements to strip
  engagementGroup: '[role="group"]',
  followButton: '[data-testid$="-follow"]',
  caret: '[data-testid="caret"]',
  readMore: '[data-testid="tweet-text-show-more-link"]',
} as const;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isArticlePage(): boolean {
  return !!(
    document.querySelector(SELECTORS.articleTitle) ||
    document.querySelector(SELECTORS.articleRichText) ||
    document.querySelector(SELECTORS.articleDraftContent)
  );
}

export function extractDate(): string {
  const timeEl = document.querySelector('article[role="article"] time');
  if (timeEl) {
    const datetime = timeEl.getAttribute('datetime');
    if (datetime) return datetime;
    return timeEl.textContent?.trim() || '';
  }
  return new Date().toISOString();
}

export function extractTweetId(): string {
  const match = window.location.pathname.match(/\/status\/(\d+)/);
  return match?.[1] || 'unknown';
}

// Stable ID for a tweet article, derived from its timestamp permalink.
export function getTweetStatusId(article: Element): string {
  const timeLink = article.querySelector('a[href*="/status/"] time');
  if (timeLink) {
    const href = timeLink.closest('a')?.getAttribute('href') || '';
    const m = href.match(/\/status\/(\d+)/);
    if (m) return m[1];
  }
  const analyticsLink = article.querySelector('a[href*="/analytics"]');
  if (analyticsLink) {
    const href = analyticsLink.getAttribute('href') || '';
    const m = href.match(/\/status\/(\d+)/);
    if (m) return m[1];
  }
  const textEl = article.querySelector('[data-testid="tweetText"]');
  return textEl?.textContent?.trim().slice(0, 80) || Math.random().toString();
}

export function cleanContentClone(container: Element): Element {
  const clone = container.cloneNode(true) as Element;

  clone.querySelectorAll('[role="group"]').forEach((el) => el.remove());
  clone.querySelectorAll('[data-testid$="-follow"]').forEach((el) => el.remove());
  clone.querySelectorAll('[data-testid="caret"]').forEach((el) => el.remove());
  clone
    .querySelectorAll('[data-testid="tweet-text-show-more-link"]')
    .forEach((el) => el.remove());

  clone.querySelectorAll('[aria-label="Share post"]').forEach((el) => el.remove());
  clone.querySelectorAll('[aria-label="Bookmark"]').forEach((el) => el.remove());
  clone.querySelectorAll('[data-testid="bookmark"]').forEach((el) => el.remove());

  clone.querySelectorAll('a[href*="/subscribe"]').forEach((el) => {
    const parent = el.closest('div[role="link"]') || el.parentElement;
    parent?.remove();
  });

  clone.querySelectorAll('button, nav, [role="navigation"]').forEach((el) => el.remove());

  clone.querySelectorAll('[aria-hidden="true"]').forEach((el) => {
    if (!el.querySelector('img') && el.tagName !== 'IMG') {
      el.remove();
    }
  });

  return clone;
}

export function extractAuthor(): { name: string; handle: string } {
  const userNameEl = document.querySelector(SELECTORS.userName);
  if (!userNameEl) return { name: 'Unknown', handle: 'unknown' };
  return parseAuthorFromElement(userNameEl);
}

export function extractAuthorFromArticle(
  article: Element
): { name: string; handle: string } {
  const userNameEl = article.querySelector(SELECTORS.userName);
  if (!userNameEl) return { name: 'Unknown', handle: 'unknown' };
  return parseAuthorFromElement(userNameEl);
}

function parseAuthorFromElement(userNameEl: Element): { name: string; handle: string } {
  const links = userNameEl.querySelectorAll('a');
  let name = 'Unknown';
  let handle = 'unknown';

  for (const link of links) {
    const text = link.textContent?.trim() || '';
    if (text.startsWith('@')) {
      handle = text;
    } else if (text && name === 'Unknown') {
      name = text;
    }
  }

  if (handle === 'unknown') {
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/^\/([A-Za-z0-9_]+)$/);
      if (match) {
        handle = `@${match[1]}`;
        break;
      }
    }
  }

  // Fallback: quoted-tweet blocks wrap the whole quote in an outer link, so the
  // inner name / handle render as plain spans (zero <a> tags). Parse from text.
  if (name === 'Unknown' || handle === 'unknown' || isTimestampLabel(name)) {
    const txt = (userNameEl.textContent || '').replace(/\s+/g, ' ').trim();
    const handleMatch = txt.match(/@[A-Za-z0-9_]+/);
    if (handleMatch && handle === 'unknown') handle = handleMatch[0];
    if (handleMatch && (name === 'Unknown' || isTimestampLabel(name))) {
      const idx = handleMatch ? txt.indexOf(handleMatch[0]) : -1;
      const nameText = idx > 0 ? txt.slice(0, idx).trim() : txt;
      if (nameText) name = nameText;
    }
  }

  return { name, handle };
}

function isTimestampLabel(value: string): boolean {
  return /^(?:\d+[smhd]|\d+[smhd]\s|[A-Z][a-z]{2}\s+\d{1,2}|\d{1,2}:\d{2}\s*(?:AM|PM)?)$/.test(value.trim());
}
