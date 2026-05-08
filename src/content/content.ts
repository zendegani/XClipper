import TurndownService from 'turndown';
import type { DownloadRequest, ExtractedContent, ExtractResponse, TweetMetadata } from '../types/messages';
import { postProcess } from '../shared/post-process';

// ─── Turndown Instance ──────────────────────────────────────────────
const turndown = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
  linkStyle: 'inlined',
});

// Custom rule: resolve t.co links using visible text or title attribute
turndown.addRule('tcoLinks', {
  filter: (node) =>
    node.nodeName === 'A' &&
    !!(node as HTMLAnchorElement).getAttribute('href')?.includes('t.co'),
  replacement: (_content, node) => {
    const anchor = node as HTMLAnchorElement;
    const title = anchor.getAttribute('title');
    const visibleText = anchor.textContent?.trim() || '';

    // Prefer title (full URL), fall back to visible text
    const displayUrl = title && title.startsWith('http') ? title : visibleText;
    const targetUrl = title && title.startsWith('http') ? title : anchor.href;

    // If visible text looks like a URL, use it directly
    if (displayUrl.startsWith('http') || displayUrl.includes('.')) {
      return `[${displayUrl}](${targetUrl})`;
    }

    return `[${visibleText}](${targetUrl})`;
  },
});

// Custom rule: handle images with src extraction
turndown.addRule('xImages', {
  filter: 'img',
  replacement: (_content, node) => {
    const img = node as HTMLImageElement;
    const alt = img.getAttribute('alt') || 'Image';
    let src = img.getAttribute('src') || '';

    // Emoji images → just return the emoji character (alt text)
    if (src.includes('twimg.com/emoji') || src.includes('abs-0.twimg.com')) {
      return alt;
    }

    // Use the highest quality version available
    if (src.includes('pbs.twimg.com') && !src.includes('format=')) {
      src = src.replace(/&name=\w+/, '&name=large');
    }

    return src ? `![${alt}](${src})` : '';
  },
});

// Custom rule: handle videos → just output the poster/thumbnail URL
turndown.addRule('xVideos', {
  filter: 'video',
  replacement: (_content, node) => {
    const video = node as HTMLVideoElement;
    const poster = video.getAttribute('poster') || '';
    const src = video.querySelector('source')?.getAttribute('src') || '';
    const url = src || poster;
    return url ? `[🎥 Video](${url})` : '[🎥 Video]';
  },
});

// Custom rule: fix bold/italic with leading/trailing whitespace inside the tag.
// E.g. <strong>text </strong> → Turndown produces **text ** which is broken markdown.
// This moves the whitespace outside the delimiter: **text** + space.
turndown.addRule('fixBoldWhitespace', {
  filter: (node) =>
    node.nodeName === 'STRONG' || node.nodeName === 'B' ||
    (node instanceof HTMLElement && node.style.fontWeight === 'bold'),
  replacement: (content) => {
    const trimmed = content.replace(/\s+/g, ' ').trim();
    if (!trimmed) return content;
    const leading = /^\s/.test(content) ? ' ' : '';
    const trailing = /\s$/.test(content) ? ' ' : '';
    return `${leading}**${trimmed}**${trailing}`;
  },
});

turndown.addRule('fixItalicWhitespace', {
  filter: (node) =>
    node.nodeName === 'EM' || node.nodeName === 'I' ||
    (node instanceof HTMLElement && node.style.fontStyle === 'italic'),
  replacement: (content) => {
    const trimmed = content.replace(/\s+/g, ' ').trim();
    if (!trimmed) return content;
    const leading = /^\s/.test(content) ? ' ' : '';
    const trailing = /\s$/.test(content) ? ' ' : '';
    return `${leading}*${trimmed}*${trailing}`;
  },
});

// Custom rule: convert <br> to markdown hard line break (two trailing spaces)
// Turndown's default \n doesn't render as a line break in markdown.
turndown.addRule('lineBreaks', {
  filter: 'br',
  replacement: () => '  \n',
});

// Custom rule: handle @mention links inline (no surrounding line breaks)
turndown.addRule('atMentions', {
  filter: (node) => {
    if (node.nodeName !== 'A') return false;
    const href = (node as HTMLAnchorElement).getAttribute('href') || '';
    // Match links like /username (internal profile links)
    return /^\/[A-Za-z0-9_]+$/.test(href);
  },
  replacement: (_content, node) => {
    const anchor = node as HTMLAnchorElement;
    const text = anchor.textContent?.trim() || '';
    // Return just @handle with no extra whitespace
    return text.startsWith('@') ? text : `@${text}`;
  },
});

/**
 * Clean up markdown output:
 * - Collapse line breaks around @mentions and trailing punctuation
 * - Remove blank lines between inline elements that should flow together
 */
function cleanupMarkdown(md: string): string {
  // Collapse: "text\n\n@handle\n\n, more text" → "text @handle, more text"
  // Step 1: Remove leading blank lines before @mentions
  let result = md.replace(/\n{2,}(@[A-Za-z0-9_]+)/g, ' $1');
  // Step 2: Remove trailing blank line + punctuation after @mentions  
  result = result.replace(/(@[A-Za-z0-9_]+)\n{2,}([.,;:!?])/g, '$1$2');
  // Step 3: Collapse remaining blank lines between @mentions
  result = result.replace(/(@[A-Za-z0-9_]+[.,;:!?]?)\n{2,}(@[A-Za-z0-9_]+)/g, '$1 $2');
  // Step 4: Collapse orphaned punctuation on its own line
  result = result.replace(/\n{2,}([.,;:!?])\s*\n/g, '$1\n');
  // Step 5: Collapse trailing punctuation (e.g. "." on its own line after a handle)
  result = result.replace(/(@[A-Za-z0-9_]+)\n{2,}([.,;:!?])\s*$/gm, '$1$2');
  return result;
}

// ─── DOM Selectors (2026 X.com) ─────────────────────────────────────

const SELECTORS = {
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

// ─── Detection ──────────────────────────────────────────────────────

function isArticlePage(): boolean {
  // Check for X.com Article/Notes specific elements
  return !!(
    document.querySelector(SELECTORS.articleTitle) ||
    document.querySelector(SELECTORS.articleRichText) ||
    document.querySelector(SELECTORS.articleDraftContent)
  );
}

// ─── Author Extraction ──────────────────────────────────────────────

function extractAuthor(): { name: string; handle: string } {
  const userNameEl = document.querySelector(SELECTORS.userName);
  if (!userNameEl) return { name: 'Unknown', handle: 'unknown' };

  // The User-Name testid typically has two child divs/spans:
  // first contains display name, second contains @handle
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

  // If handle wasn't found with @, try extracting from href
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

  return { name, handle };
}

// ─── Date Extraction ────────────────────────────────────────────────

function extractDate(): string {
  const timeEl = document.querySelector('article[role="article"] time');
  if (timeEl) {
    const datetime = timeEl.getAttribute('datetime');
    if (datetime) return datetime;
    return timeEl.textContent?.trim() || '';
  }
  return new Date().toISOString();
}

// ─── Tweet ID Extraction ────────────────────────────────────────────

function extractTweetId(): string {
  const match = window.location.pathname.match(/\/status\/(\d+)/);
  return match?.[1] || 'unknown';
}

// ─── HTML Cleaning ──────────────────────────────────────────────────

function cleanContentClone(container: Element): Element {
  const clone = container.cloneNode(true) as Element;

  // Remove engagement counts (likes, retweets, replies bar)
  clone.querySelectorAll('[role="group"]').forEach((el) => el.remove());

  // Remove follow buttons
  clone.querySelectorAll('[data-testid$="-follow"]').forEach((el) => el.remove());

  // Remove the caret/more menu
  clone.querySelectorAll('[data-testid="caret"]').forEach((el) => el.remove());

  // Remove "Read more" / "Show more" links
  clone
    .querySelectorAll('[data-testid="tweet-text-show-more-link"]')
    .forEach((el) => el.remove());

  // Remove share/bookmark buttons
  clone.querySelectorAll('[aria-label="Share post"]').forEach((el) => el.remove());
  clone.querySelectorAll('[aria-label="Bookmark"]').forEach((el) => el.remove());
  clone.querySelectorAll('[data-testid="bookmark"]').forEach((el) => el.remove());

  // Remove "Subscribe" CTA blocks
  clone.querySelectorAll('a[href*="/subscribe"]').forEach((el) => {
    // Remove the parent container if it looks like a CTA card
    const parent = el.closest('div[role="link"]') || el.parentElement;
    parent?.remove();
  });

  // Remove buttons and navigation elements
  clone.querySelectorAll('button, nav, [role="navigation"]').forEach((el) => el.remove());

  // Remove hidden elements
  clone.querySelectorAll('[aria-hidden="true"]').forEach((el) => {
    // Keep images that are aria-hidden (X sometimes does this)
    if (!el.querySelector('img') && el.tagName !== 'IMG') {
      el.remove();
    }
  });

  return clone;
}

// ─── Per-Article Helpers ────────────────────────────────────────────

/**
 * Extract author info from a specific article element (not the global page).
 */
function extractAuthorFromArticle(
  article: Element
): { name: string; handle: string } {
  const userNameEl = article.querySelector(SELECTORS.userName);
  if (!userNameEl) return { name: 'Unknown', handle: 'unknown' };

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

  return { name, handle };
}

/**
 * Helper to extract markdown text from a text element.
 */
function extractTextFromElement(textEl: Element): string {
  const cleaned = cleanContentClone(textEl);

  // X.com uses literal \n inside <span> for tweet line breaks (not <br>).
  // HTML collapses these to spaces, so convert them to <br> before Turndown.
  const walker = document.createTreeWalker(cleaned, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const tn of textNodes) {
    if (tn.textContent && tn.textContent.includes('\n')) {
      const parts = tn.textContent.split('\n');
      const parent = tn.parentNode!;
      for (let j = 0; j < parts.length; j++) {
        if (j > 0) parent.insertBefore(document.createElement('br'), tn);
        parent.insertBefore(document.createTextNode(parts[j]), tn);
      }
      parent.removeChild(tn);
    }
  }

  return cleanupMarkdown(turndown.turndown(cleaned.innerHTML)).trim();
}

/**
 * Extract text + media markdown from a single article element.
 * Returns { text, media } where text is the tweet body markdown
 * and media is an array of media markdown strings.
 */
function extractSingleTweetFromArticle(
  article: Element
): { text: string; media: string[] } {
  // Extract the main tweet text (first tweetText only — subsequent ones may be
  // inside a Quote Tweet embed)
  const tweetTextEls = article.querySelectorAll(SELECTORS.tweetText);
  let text = '';

  if (tweetTextEls.length > 0) {
    text = extractTextFromElement(tweetTextEls[0]);
  }

  // ── Embedded content: Quote Tweet, Quoted Article, or Link Card ─────
  // We check for these in order of specificity.

  let embeddedMd = '';

  // 1) Quote Tweet — a second tweetText inside a role="link" container
  if (tweetTextEls.length > 1) {
    const quoteEl = tweetTextEls[1];
    const quoteContainer = quoteEl.closest('div[role="link"]');

    let quoteAuthorInfo = '';
    if (quoteContainer) {
      const qa = extractAuthorFromArticle(quoteContainer);
      if (qa.name !== 'Unknown') {
        quoteAuthorInfo = `**${qa.name} (${qa.handle})**\n> \n> `;
      }
    }

    const rawQuoteText = extractTextFromElement(quoteEl);
    if (rawQuoteText) {
      const blockquotedText = rawQuoteText.split('\n').join('\n> ');
      embeddedMd = `\n\n> ${quoteAuthorInfo}${blockquotedText}`;
    }
  }

  // 2) Quoted Article (X Notes) — role="link" container with an article-cover-image
  //    but NO tweetText inside (otherwise it would have been caught above).
  if (!embeddedMd) {
    const quoteLinkContainers = article.querySelectorAll('div[role="link"]');
    for (const container of quoteLinkContainers) {
      const coverImgContainer = container.querySelector('[data-testid="article-cover-image"]');
      if (!coverImgContainer) continue;

      // Extract cover image URL
      const coverImgEl = coverImgContainer.querySelector('img');
      let coverImgSrc = '';
      if (coverImgEl) {
        coverImgSrc = (coverImgEl as HTMLImageElement).src || '';
        if (coverImgSrc.includes('pbs.twimg.com')) {
          coverImgSrc = coverImgSrc.replace(/&name=\w+/, '&name=large');
        }
      }

      // Extract author
      const qa = extractAuthorFromArticle(container);
      let header = '';
      if (qa.name !== 'Unknown') {
        header = `**${qa.name} (${qa.handle})**\n> \n> `;
      }

      // The article card title + description are in div[dir="auto"] elements
      // that are NOT inside the User-Name or avatar sections.
      const allTextDivs = container.querySelectorAll('div[dir="auto"]');
      let title = '';
      let description = '';
      for (const d of allTextDivs) {
        // Skip divs inside author/avatar sections
        if (d.closest('[data-testid="User-Name"]')) continue;
        if (d.closest('[data-testid="Tweet-User-Avatar"]')) continue;
        const t = d.textContent?.trim() || '';
        if (!t) continue;
        // Skip the "Article" badge label and timestamps
        if (t === 'Article' || t === 'Quote') continue;
        if (!title) {
          title = t;
        } else if (!description) {
          description = t;
        }
      }

      if (title) {
        const parts: string[] = [];
        if (coverImgSrc) parts.push(`![Article cover](${coverImgSrc})`);
        parts.push(`📝 **${title}**`);
        if (description) parts.push(description);
        const body = parts.join('\n> \n> ');
        embeddedMd = `\n\n> ${header}${body}`;
      }
      break; // only first article quote
    }
  }

  // 3) Link Card — data-testid="card.wrapper" with title + description
  if (!embeddedMd) {
    const cardWrapper = article.querySelector('[data-testid="card.wrapper"]');
    if (cardWrapper) {
      // Extract the link URL
      const cardLink = cardWrapper.querySelector('a[href]');
      const href = cardLink?.getAttribute('href') || '';

      // Extract card detail elements
      const detail = cardWrapper.querySelector(
        '[data-testid="card.layoutSmall.detail"], [data-testid="card.layoutLarge.detail"]'
      );
      const detailDivs = detail
        ? detail.querySelectorAll('div[dir="auto"]')
        : cardWrapper.querySelectorAll('div[dir="auto"]');

      let domain = '';
      let title = '';
      let description = '';
      for (const d of detailDivs) {
        const t = d.textContent?.trim() || '';
        if (!t) continue;
        if (!domain) {
          domain = t;
        } else if (!title) {
          title = t;
        } else if (!description) {
          description = t;
        }
      }

      if (title) {
        const parts: string[] = [];
        if (href) {
          parts.push(`🔗 [**${title}**](${href})`);
        } else {
          parts.push(`🔗 **${title}**`);
        }
        if (description) parts.push(description);
        if (domain) parts.push(`_${domain}_`);
        embeddedMd = `\n\n> ${parts.join('\n> \n> ')}`;
      }
    }
  }

  text += embeddedMd;

  // Extract media
  const media: string[] = [];

  // Images
  const photos = article.querySelectorAll(`${SELECTORS.tweetPhoto} img`);
  photos.forEach((img) => {
    let src = (img as HTMLImageElement).src;
    if (src && !src.includes('emoji') && !src.includes('profile_images')) {
      if (src.includes('pbs.twimg.com')) {
        src = src.replace(/&name=\w+/, '&name=large');
      }
      media.push(`![Image](${src})`);
    }
  });

  // Videos
  const videos = article.querySelectorAll('video');
  videos.forEach((video) => {
    const poster = video.getAttribute('poster');
    if (poster) {
      media.push(`[🎥 Video](${poster})`);
    }
  });

  return { text, media };
}

// ─── Tweet / Thread Extraction ──────────────────────────────────────

/**
 * Extract a stable ID for a tweet article from its timestamp permalink.
 * Falls back to the tweet text as a last resort (for deduplication).
 */
function getTweetStatusId(article: Element): string {
  // Timestamp links look like /handle/status/<id>
  const timeLink = article.querySelector('a[href*="/status/"] time');
  if (timeLink) {
    const href = timeLink.closest('a')?.getAttribute('href') || '';
    const m = href.match(/\/status\/(\d+)/);
    if (m) return m[1];
  }
  // Fallback: analytics link
  const analyticsLink = article.querySelector('a[href*="/analytics"]');
  if (analyticsLink) {
    const href = analyticsLink.getAttribute('href') || '';
    const m = href.match(/\/status\/(\d+)/);
    if (m) return m[1];
  }
  // Last resort: use trimmed tweet text as key
  const textEl = article.querySelector('[data-testid="tweetText"]');
  return textEl?.textContent?.trim().slice(0, 80) || Math.random().toString();
}

/**
 * Extract engagement metadata from a tweet's role="group" aria-label.
 * Example: "3 replies, 5 reposts, 152 likes, 175 bookmarks, 45025 views"
 */
function extractEngagementMetadata(
  scope: Element | Document = document
): TweetMetadata | undefined {
  // Find all engagement groups; the first one in the first article is the main tweet's
  const group = scope.querySelector('[role="group"][aria-label]');
  if (!group) return undefined;

  const label = group.getAttribute('aria-label') || '';
  if (!label) return undefined;

  const meta: TweetMetadata = {};

  const repliesMatch = label.match(/([\d,]+)\s*repl/i);
  if (repliesMatch) meta.replies = parseInt(repliesMatch[1].replace(/,/g, ''), 10);

  const repostsMatch = label.match(/([\d,]+)\s*repost/i);
  if (repostsMatch) meta.reposts = parseInt(repostsMatch[1].replace(/,/g, ''), 10);

  const likesMatch = label.match(/([\d,]+)\s*like/i);
  if (likesMatch) meta.likes = parseInt(likesMatch[1].replace(/,/g, ''), 10);

  const bookmarksMatch = label.match(/([\d,]+)\s*bookmark/i);
  if (bookmarksMatch) meta.bookmarks = parseInt(bookmarksMatch[1].replace(/,/g, ''), 10);

  const viewsMatch = label.match(/([\d,]+)\s*view/i);
  if (viewsMatch) meta.views = parseInt(viewsMatch[1].replace(/,/g, ''), 10);

  return Object.keys(meta).length > 0 ? meta : undefined;
}

/** Small async delay helper */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Scroll-aware thread extraction.
 *
 * X.com uses a virtualized list — only tweets near the viewport exist in the
 * DOM at any given moment. To capture a full thread we:
 *   1. Scroll to the very top of the page.
 *   2. Collect all visible thread-author tweets (stopping on a different-author
 *      tweet, which signals the start of the reply section).
 *   3. Scroll down a step and repeat, deduplicating by status ID.
 *   4. Stop once no new thread tweets appear after a scroll (thread complete)
 *      OR we hit a different-author tweet.
 */
async function extractTweetAsync(): Promise<ExtractedContent> {
  const date = extractDate();
  const tweetId = extractTweetId();
  const sourceUrl = window.location.href;

  // ── Step 1: scroll to top so we start from the first tweet ──────────
  window.scrollTo({ top: 0, behavior: 'instant' });
  await delay(600); // wait for virtualized list to settle

  // Determine thread author from whatever is now at the top of the DOM
  let allArticles = document.querySelectorAll('article[role="article"]');
  if (allArticles.length === 0) {
    const author = extractAuthor();
    return {
      type: 'tweet',
      author,
      markdown: `# ${author.name} (${author.handle})\n\n*Could not extract tweet content.*\n\n---\n\n> Source: ${sourceUrl}\n> Date: ${date}`,
      sourceUrl,
      date,
      tweetId,
    };
  }

  const threadAuthor = extractAuthorFromArticle(allArticles[0]);

  // ── Step 2: scroll loop ──────────────────────────────────────────────
  // Ordered map: statusId → extracted tweet data (insertion order = thread order)
  const collected = new Map<string, { text: string; media: string[] }>();
  let threadDone = false;

  const SCROLL_STEP = Math.max(window.innerHeight * 0.6, 400);
  const MAX_STEPS = 60;

  for (let step = 0; step < MAX_STEPS && !threadDone; step++) {
    allArticles = document.querySelectorAll('article[role="article"]');
    const sizeBefore = collected.size;

    for (const article of allArticles) {
      const articleAuthor = extractAuthorFromArticle(article);
      if (
        articleAuthor.handle.toLowerCase() !==
        threadAuthor.handle.toLowerCase()
      ) {
        // First tweet by a different author → reply section, stop collecting.
        threadDone = true;
        break;
      }
      const sid = getTweetStatusId(article);
      if (!collected.has(sid)) {
        collected.set(sid, extractSingleTweetFromArticle(article));
      }
    }

    if (threadDone) break;

    const atBottom =
      window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 50;
    if (atBottom && collected.size === sizeBefore) break;

    window.scrollBy({ top: SCROLL_STEP, behavior: 'instant' });
    await delay(400);
  }

  // ── Step 3: restore scroll position ─────────────────────────────────
  window.scrollTo({ top: 0, behavior: 'instant' });

  // ── Step 4: build markdown ───────────────────────────────────────────
  const threadTweets = Array.from(collected.values());
  const isThread = threadTweets.length > 1;
  const parts: string[] = [
    `# ${threadAuthor.name} (${threadAuthor.handle})`,
    '',
  ];

  threadTweets.forEach((tweet, idx) => {
    if (idx > 0) {
      parts.push('', '---', '');
    }
    if (tweet.text) {
      parts.push(tweet.text);
    }
    if (tweet.media.length > 0) {
      parts.push('', ...tweet.media);
    }
  });

  parts.push('', '---', '', `> Source: ${sourceUrl}`, `> Date: ${date}`);

  return {
    type: isThread ? 'thread' : 'tweet',
    author: threadAuthor,
    markdown: parts.join('\n'),
    sourceUrl,
    date,
    tweetId,
  };
}

// ─── Article Extraction ─────────────────────────────────────────────

/**
 * X.com Articles ("Notes") use Draft.js for rich text rendering.
 * Structure:
 *   [data-testid="twitter-article-title"] → Title
 *   [data-testid="twitterArticleRichTextView"] → Body container
 *     └─ [data-testid="longformRichTextComponent"] → Draft.js content
 *         ├─ .longform-unstyled  → paragraphs
 *         ├─ .longform-header-one / .longform-header-two → headings
 *         ├─ .longform-unordered-list-item → bullet lists
 *         ├─ section[role="separator"] → horizontal rules
 *         └─ [data-testid="markdown-code-block"] → code blocks
 */
function extractArticle(): ExtractedContent {
  const author = extractAuthor();
  const date = extractDate();
  const tweetId = extractTweetId();
  const sourceUrl = window.location.href;

  // ── Extract title ─────────────────────────────────────────────
  let title: string | undefined;
  const titleEl = document.querySelector(SELECTORS.articleTitle);
  if (titleEl) {
    title = titleEl.textContent?.trim();
  }

  // ── Extract banner / header image ─────────────────────────────
  let bannerImageMd = '';
  const articleEl = document.querySelector('article[role="article"]');
  if (articleEl) {
    // Look for the hero image: typically inside [data-testid="tweetPhoto"]
    // or a standalone <img> inside the article but outside the Draft.js body
    const heroImg =
      articleEl.querySelector(`${SELECTORS.tweetPhoto} img`) ||
      articleEl.querySelector('[data-testid="card.layoutLarge.media"] img');
    if (heroImg) {
      let src = (heroImg as HTMLImageElement).src || '';
      if (
        src &&
        !src.includes('emoji') &&
        !src.includes('profile_images') &&
        !src.includes('hashflags')
      ) {
        // Request highest quality
        if (src.includes('pbs.twimg.com')) {
          src = src.replace(/&name=\w+/, '&name=large');
        }
        bannerImageMd = `![Banner](${src})`;
      }
    }
  }

  // ── Extract rich text body ────────────────────────────────────
  const richTextView = document.querySelector(SELECTORS.articleRichText);
  if (!richTextView) {
    throw new Error(
      'Could not find the article body. The page may not have fully loaded.'
    );
  }

  // Build markdown manually from Draft.js blocks for better control
  const mdParts: string[] = [];
  const draftContent =
    richTextView.querySelector(SELECTORS.articleDraftContent) || richTextView;

  // Get direct children of [data-contents] or the content root
  const dataContents =
    draftContent.querySelector('[data-contents]') || draftContent;
  const blocks = dataContents.children;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i] as HTMLElement;

    // ── Code block (MUST check before separator — both use <section>) ──
    const codeBlock = block.querySelector('[data-testid="markdown-code-block"]');
    if (codeBlock || block.getAttribute('data-testid') === 'markdown-code-block') {
      const cb = codeBlock || block;
      // Language label: look for code tag's class or the label span
      const codeEl = cb.querySelector('code');
      const langFromClass = codeEl?.className?.match(/language-(\w+)/)?.[1] || '';
      // Fallback: the small label span above the code block
      const langLabel = cb.querySelector('[class*="r-1aiqnjv"]');
      const lang = langFromClass || langLabel?.textContent?.trim() || '';
      const preEl = cb.querySelector('pre');
      const codeSource = preEl?.querySelector('code') || preEl;
      const codeText = codeSource?.textContent || '';
      mdParts.push('', `\`\`\`${lang}`, codeText.trimEnd(), '\`\`\`', '');
      continue;
    }

    // ── Separator (horizontal rule) ──
    // Only match if the block contains [role="separator"] (not just any <section>)
    if (block.querySelector('[role="separator"]')) {
      mdParts.push('', '---', '');
      continue;
    }

    // ── Header (h1) ──
    const h1 = block.querySelector('.longform-header-one') || 
               (block.classList.contains('longform-header-one') ? block : null);
    if (h1 || block.querySelector('h1.longform-header-one')) {
      const heading = block.textContent?.trim() || '';
      if (heading) mdParts.push('', `# ${heading}`, '');
      continue;
    }

    // ── Header (h2) ──
    const h2 = block.querySelector('.longform-header-two') ||
               (block.classList.contains('longform-header-two') ? block : null);
    if (h2 || block.querySelector('h2.longform-header-two')) {
      const heading = block.textContent?.trim() || '';
      if (heading) mdParts.push('', `## ${heading}`, '');
      continue;
    }

    // ── Unordered list ──
    if (block.tagName === 'UL') {
      const items = block.querySelectorAll('.longform-unordered-list-item');
      items.forEach((li) => {
        const text = extractInlineText(li);
        if (text) mdParts.push(`- ${text}`);
      });
      mdParts.push(''); // blank line so the next block isn't folded into the last item
      continue;
    }

    // ── Single list item (sometimes not wrapped in UL) ──
    if (block.classList.contains('longform-unordered-list-item')) {
      const text = extractInlineText(block);
      if (text) mdParts.push(`- ${text}`);
      mdParts.push('');
      continue;
    }

    // ── Ordered list ──
    if (block.tagName === 'OL') {
      const items = block.querySelectorAll('li');
      items.forEach((li, idx) => {
        const text = extractInlineText(li);
        if (text) mdParts.push(`${idx + 1}. ${text}`);
      });
      mdParts.push('');
      continue;
    }

    // ── Regular paragraph (.longform-unstyled or generic div) ──
    const text = extractInlineText(block);
    if (text) {
      mdParts.push(text, '');
    } else if (block.textContent?.trim() === '') {
      // Empty paragraph → blank line
      mdParts.push('');
    }
  }

  let bodyMarkdown = mdParts.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // ── Compose final markdown ────────────────────────────────────
  const parts: string[] = [];

  if (title) {
    parts.push(`# ${title}`, '', `*By ${author.name} (${author.handle})*`, '');
  } else {
    parts.push(`# Article by ${author.name} (${author.handle})`, '');
  }

  if (bannerImageMd) {
    parts.push(bannerImageMd, '');
  }

  parts.push(bodyMarkdown, '', '---', '', `> Source: ${sourceUrl}`, `> Date: ${date}`);

  return {
    type: 'article',
    author,
    title,
    markdown: parts.join('\n'),
    sourceUrl,
    date,
    tweetId,
  };
}

/**
 * Check if an element is a small inline wrapper for a link (not a content container).
 * X.com wraps links in <div class="css-175oi2r r-1loqt21 ..."> inline containers.
 * These only contain the <a> tag. A content container (like DraftStyleDefault-block)
 * will have multiple children: text spans + link divs + more text spans.
 */
function isInlineLinkWrapper(el: HTMLElement): boolean {
  // If it has a data-offset-key, it's a Draft.js content block, not a link wrapper
  if (el.hasAttribute('data-offset-key')) return false;
  // If it has Draft.js block classes, it's a content container
  if (el.className.includes('DraftStyleDefault')) return false;
  if (el.className.includes('longform-')) return false;

  // An inline link wrapper typically has only 1 child element (the <a>)
  // and no direct TEXT_NODE children with meaningful text
  const childElements = Array.from(el.children);
  const hasOnlyLink = childElements.length === 1 && childElements[0].tagName === 'A';
  const hasLink = childElements.some(c => c.tagName === 'A' || c.querySelector('a'));

  // If it only contains a link (no sibling text/span content), it's a wrapper
  if (hasOnlyLink) return true;

  // Also check: no text-bearing siblings alongside the link
  let textLen = 0;
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      textLen += (child.textContent || '').trim().length;
    }
  }

  return hasLink && textLen === 0 && childElements.length <= 2;
}

/**
 * Extract inline text from a Draft.js block, preserving bold/italic/links.
 */
function extractImageMd(img: HTMLImageElement): string {
  const alt = img.getAttribute('alt') || 'Image';
  let src = img.getAttribute('src') || '';
  if (!src) return '';
  if (src.includes('twimg.com/emoji') || src.includes('abs-0.twimg.com')) {
    return alt;
  }
  if (src.includes('pbs.twimg.com')) {
    src = src.replace(/&name=\w+/, '&name=large');
  }
  return `![${alt}](${src})`;
}

function extractInlineText(el: Element): string {
  let result = '';

  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += child.textContent || '';
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const elem = child as HTMLElement;

    // ── Bare image (no link wrapper) ──
    if (elem.tagName === 'IMG') {
      const md = extractImageMd(elem as HTMLImageElement);
      if (md) result += md;
      continue;
    }

    // ── Direct link ──
    if (elem.tagName === 'A') {
      const anchor = elem as HTMLAnchorElement;
      const href = anchor.getAttribute('href') || '';
      const linkText = anchor.textContent?.trim() || '';
      const fullHref = href.startsWith('//')
        ? `https:${href}`
        : href.startsWith('/')
        ? `https://x.com${href}`
        : href;
      // Article inline images are <a href="/.../media/..."> wrapping an <img>.
      // Emit just the image markdown so the file looks clean and the popup's
      // image-localization regex picks it up.
      const innerImg = anchor.querySelector('img') as HTMLImageElement | null;
      if (innerImg && !linkText) {
        const md = extractImageMd(innerImg);
        if (md) result += md;
        continue;
      }
      result += `[${linkText}](${fullHref})`;
      continue;
    }

    // ── Inline link wrapper (small div/span wrapping ONLY an <a>) ──
    // X.com wraps links in a <div class="css-175oi2r r-1loqt21 ..."> container
    // IMPORTANT: Don't match large container divs (like DraftStyleDefault-block)
    // that happen to contain a link somewhere deep inside alongside other content.
    if (elem.querySelector('a') && isInlineLinkWrapper(elem)) {
      const anchor = elem.querySelector('a')!;
      const href = anchor.getAttribute('href') || '';
      const linkText = anchor.textContent?.trim() || '';
      const fullHref = href.startsWith('//')
        ? `https:${href}`
        : href.startsWith('/')
        ? `https://x.com${href}`
        : href;
      const innerImg = anchor.querySelector('img') as HTMLImageElement | null;
      if (innerImg && !linkText) {
        const md = extractImageMd(innerImg);
        if (md) result += md;
        continue;
      }
      result += `[${linkText}](${fullHref})`;
      continue;
    }

    // ── Bold ──
    if (elem.style.fontWeight === 'bold' || elem.tagName === 'STRONG' || elem.tagName === 'B') {
      const inner = extractInlineText(elem);
      const trimmed = inner.replace(/\s+/g, ' ').trim();
      if (trimmed) {
        const leading = inner.match(/^(\s*)/)?.[1] ? ' ' : '';
        const trailing = inner.match(/(\s+)$/)?.[1] ? ' ' : '';
        result += `${leading}**${trimmed}**${trailing}`;
      }
      continue;
    }

    // ── Italic ──
    if (elem.style.fontStyle === 'italic' || elem.tagName === 'EM' || elem.tagName === 'I') {
      const inner = extractInlineText(elem);
      const trimmed = inner.replace(/\s+/g, ' ').trim();
      if (trimmed) {
        const leading = inner.match(/^(\s*)/)?.[1] ? ' ' : '';
        const trailing = inner.match(/(\s+)$/)?.[1] ? ' ' : '';
        result += `${leading}*${trimmed}*${trailing}`;
      }
      continue;
    }

    // ── Recurse into other elements (spans, content wrapper divs, etc.) ──
    result += extractInlineText(elem);
  }

  return result;
}

// ─── Main Extraction Entry Point ────────────────────────────────────

async function extract(options?: {
  includeMetadata?: boolean;
}): Promise<ExtractResponse> {
  try {
    // Verify we're on a status page
    if (!window.location.pathname.includes('/status/')) {
      return {
        success: false,
        error: 'Not on an X.com status page. Navigate to a tweet or article first.',
      };
    }

    const isArticle = isArticlePage();
    const data = isArticle ? extractArticle() : await extractTweetAsync();

    // Optionally attach engagement metadata
    if (options?.includeMetadata) {
      // Extract from the first article on the page (the focused tweet)
      const firstArticle = document.querySelector('article[role="article"]');
      if (firstArticle) {
        data.metadata = extractEngagementMetadata(firstArticle);
      }
    }

    return { success: true, data };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Message Listener ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
  if (_message.action === 'EXTRACT') {
    extract({
      includeMetadata: _message.includeMetadata || false,
    }).then(sendResponse);
  }
  return true; // keep channel open for async sendResponse
});

// ─── Auto-extract bootstrap (#tweet2md=download | #tweet2md=copy) ───
// Triggered when the page is opened from the inline button or context menu.

const AUTO_MARKER_RE = /[#&]tweet2md=(download|copy|1)/;

interface StoredSettings {
  downloadImages?: boolean;
  includeMetadata?: boolean;
  closeTabAfterExport?: boolean;
}

function loadStoredSettings(): Promise<StoredSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get('tweet2md_settings', (result) => {
      resolve((result['tweet2md_settings'] as StoredSettings) || {});
    });
  });
}

async function waitForArticle(timeoutMs = 15000): Promise<Element | null> {
  const start = Date.now();
  let article: Element | null = null;
  while (Date.now() - start < timeoutMs) {
    article = document.querySelector('article[role="article"]');
    if (article) break;
    await delay(200);
  }
  if (!article) return null;

  // For long-form articles the outer <article> wrapper renders quickly but the
  // Draft.js article body loads later. Wait for it (or its title) before we
  // hand the article to the extractor, otherwise we'd extract from an empty
  // body and miss the headline, paragraphs and images.
  const looksLikeLongForm = !!document.querySelector(
    '[data-testid="twitterArticleHeader"], a[href$="/article/edit"]'
  );
  if (looksLikeLongForm) {
    while (Date.now() - start < timeoutMs) {
      const body =
        document.querySelector('[data-testid="twitterArticleRichTextView"]') ||
        document.querySelector('[data-testid="twitter-article-title"]');
      if (body && body.textContent && body.textContent.trim().length > 0) break;
      await delay(200);
    }
  }
  return article;
}

async function autoExtract(action: 'download' | 'copy'): Promise<void> {
  // Strip the marker from the URL so refreshes don't re-trigger.
  try {
    const cleanHash = window.location.hash
      .replace(/[#&]tweet2md=(?:download|copy|1)/g, '')
      .replace(/^#$/, '');
    history.replaceState(null, '', window.location.pathname + window.location.search + (cleanHash || ''));
  } catch {
    // history API may be unavailable in some contexts; ignore
  }

  const article = await waitForArticle();
  if (!article) return;

  const settings = await loadStoredSettings();
  const includeMetadata = settings.includeMetadata !== false; // default on
  // Local image saving only makes sense when we're actually downloading a
  // sibling file. For 'copy' the clipboard can't carry images, so keep
  // absolute URLs in the markdown.
  const downloadImages = action === 'download' && settings.downloadImages === true;
  const shouldClose = settings.closeTabAfterExport === true; // default off

  const response = await extract({ includeMetadata });
  if (!response.success || !response.data) return;

  const result = postProcess(response.data, { includeMetadata, downloadImages });

  if (action === 'copy') {
    try {
      await navigator.clipboard.writeText(result.markdown);
    } catch {
      // Clipboard access may be denied if the tab isn't focused; fall back to
      // a hidden textarea + execCommand.
      const ta = document.createElement('textarea');
      ta.value = result.markdown;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
  } else {
    const downloadMsg: DownloadRequest = {
      action: 'DOWNLOAD_MD',
      content: result.markdown,
      filename: result.filename,
      images: result.images.length > 0 ? result.images : undefined,
    };
    await new Promise<void>((resolve) => {
      chrome.runtime.sendMessage(downloadMsg, () => resolve());
    });
  }

  if (shouldClose) {
    await delay(400);
    window.close();
  }
}

const autoMatch = window.location.hash.match(AUTO_MARKER_RE);
if (autoMatch) {
  const action = autoMatch[1] === 'copy' ? 'copy' : 'download';
  autoExtract(action);
}
