import type { ExtractedContent, TweetMetadata } from '../types/messages';
import { turndown, cleanupMarkdown } from './markdown';
import {
  SELECTORS,
  extractAuthor,
  extractAuthorFromArticle,
  extractDate,
  extractTweetId,
  getTweetStatusId,
  cleanContentClone,
} from './dom';
import {
  collectThreadTweets,
  createBrowserThreadCollectorEnv,
} from './thread-collector';

/**
 * Extract engagement metadata from a tweet's role="group" aria-label.
 * Example: "3 replies, 5 reposts, 152 likes, 175 bookmarks, 45025 views"
 */
export function extractEngagementMetadata(
  scope: Element | Document = document
): TweetMetadata | undefined {
  const group = scope.querySelector('[role="group"][aria-label]');
  if (!group) return undefined;

  const label = group.getAttribute('aria-label') || '';
  if (!label) return undefined;

  const meta: TweetMetadata = {};

  const replies = extractCount(label, 'repl');
  if (replies !== undefined) meta.replies = replies;

  const reposts = extractCount(label, 'repost');
  if (reposts !== undefined) meta.reposts = reposts;

  const likes = extractCount(label, 'like');
  if (likes !== undefined) meta.likes = likes;

  const bookmarks = extractCount(label, 'bookmark');
  if (bookmarks !== undefined) meta.bookmarks = bookmarks;

  const views = extractCount(label, 'view');
  if (views !== undefined) meta.views = views;

  return Object.keys(meta).length > 0 ? meta : undefined;
}

function extractCount(label: string, metricPrefix: string): number | undefined {
  const match = label.match(new RegExp(`([\\d,.]+\\s*[kmb]?)\\s*${metricPrefix}`, 'i'));
  if (!match) return undefined;

  const normalized = match[1].replace(/,/g, '').replace(/\s+/g, '').toLowerCase();
  const countMatch = normalized.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!countMatch) return undefined;

  const value = Number(countMatch[1]);
  const suffix = countMatch[2];
  const multiplier = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1;
  return Math.round(value * multiplier);
}

export function findTweetArticleByStatusId(statusId: string): Element | null {
  return (
    Array.from(document.querySelectorAll('article[role="article"]')).find(
      (article) => getTweetStatusId(article) === statusId
    ) || null
  );
}

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

function extractSingleTweetFromArticle(
  article: Element
): { text: string; media: string[] } {
  const tweetTextEls = article.querySelectorAll(SELECTORS.tweetText);
  let text = '';

  if (tweetTextEls.length > 0) {
    text = extractTextFromElement(tweetTextEls[0]);
  }

  // ── Embedded content: Quote Tweet, Quoted Article, or Link Card ─────
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

  // 2) Quoted Article (X Notes)
  if (!embeddedMd) {
    const quoteLinkContainers = article.querySelectorAll('div[role="link"]');
    for (const container of quoteLinkContainers) {
      const coverImgContainer = container.querySelector('[data-testid="article-cover-image"]');
      if (!coverImgContainer) continue;

      const coverImgEl = coverImgContainer.querySelector('img');
      let coverImgSrc = '';
      if (coverImgEl) {
        coverImgSrc = (coverImgEl as HTMLImageElement).src || '';
        if (coverImgSrc.includes('pbs.twimg.com')) {
          coverImgSrc = coverImgSrc.replace(/&name=\w+/, '&name=large');
        }
      }

      const qa = extractAuthorFromArticle(container);
      let header = '';
      if (qa.name !== 'Unknown') {
        header = `**${qa.name} (${qa.handle})**\n> \n> `;
      }

      const allTextDivs = container.querySelectorAll('div[dir="auto"]');
      let title = '';
      let description = '';
      for (const d of allTextDivs) {
        if (d.closest('[data-testid="User-Name"]')) continue;
        if (d.closest('[data-testid="Tweet-User-Avatar"]')) continue;
        const t = d.textContent?.trim() || '';
        if (!t) continue;
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
      break;
    }
  }

  // 3) Link Card
  if (!embeddedMd) {
    const cardWrapper = article.querySelector('[data-testid="card.wrapper"]');
    if (cardWrapper) {
      const cardLink = cardWrapper.querySelector('a[href]');
      const href = cardLink?.getAttribute('href') || '';

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

  // Media
  const media: string[] = [];
  const videos = Array.from(article.querySelectorAll('video'));
  const videoPosters = new Set(
    videos
      .map((video) => video.getAttribute('poster'))
      .filter((poster): poster is string => !!poster)
  );

  const photos = article.querySelectorAll(`${SELECTORS.tweetPhoto} img`);
  photos.forEach((img) => {
    let src = (img as HTMLImageElement).src;
    if (
      src &&
      !videoPosters.has(src) &&
      !src.includes('emoji') &&
      !src.includes('profile_images')
    ) {
      if (src.includes('pbs.twimg.com')) {
        src = src.replace(/&name=\w+/, '&name=large');
      }
      media.push(`![Image](${src})`);
    }
  });

  videos.forEach((video) => {
    const poster = video.getAttribute('poster');
    if (poster) {
      media.push(`[🎥 Video](${poster})`);
    }
  });

  return { text, media };
}

/**
 * Scroll-aware thread extraction.
 *
 * X.com uses a virtualized list, so thread collection is bounded and waits for
 * article mutations to settle after scrolls instead of relying on fixed sleeps.
 */
export async function extractTweetAsync(): Promise<ExtractedContent> {
  const date = extractDate();
  const tweetId = extractTweetId();
  const sourceUrl = window.location.href;
  const targetArticle = findTweetArticleByStatusId(tweetId);
  const metadata = targetArticle ? extractEngagementMetadata(targetArticle) : undefined;

  const collection = await collectThreadTweets(
    createBrowserThreadCollectorEnv({
      targetStatusId: tweetId,
      targetAuthor: extractAuthor(),
      getAuthor: extractAuthorFromArticle,
      getStatusId: getTweetStatusId,
      extractTweet: extractSingleTweetFromArticle,
    })
  );

  window.scrollTo({ top: 0, behavior: 'instant' });

  const threadTweets = collection.tweets;
  const threadAuthor = collection.author || extractAuthor();

  if (threadTweets.length === 0) {
    return {
      type: 'tweet',
      author: threadAuthor,
      markdown: `# ${threadAuthor.name} (${threadAuthor.handle})\n\n*Could not extract tweet content.*\n\n---\n\n> Source: ${sourceUrl}\n> Date: ${date}`,
      sourceUrl,
      date,
      tweetId,
      metadata,
    };
  }

  const isThread = threadTweets.length > 1 || !collection.info.complete;
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
    metadata,
    thread: isThread ? collection.info : undefined,
  };
}
