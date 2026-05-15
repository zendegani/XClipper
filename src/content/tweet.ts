import type { ExtractedContent, TweetMetadata } from '../types/messages';
import { turndown, cleanupMarkdown } from './markdown';
import {
  SELECTORS,
  delay,
  extractAuthor,
  extractAuthorFromArticle,
  extractDate,
  extractTweetId,
  getTweetStatusId,
  cleanContentClone,
} from './dom';

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

// Parses counts from X's aria-labels, handling K/M/B suffixes ("1.5K likes").
function extractCount(label: string, metricPrefix: string): number | undefined {
  const match = label.match(new RegExp(`([\\d,.]+\\s*[kmb]?)\\s*${metricPrefix}`, 'i'));
  if (!match) return undefined;

  const normalized = match[1].replace(/,/g, '').replace(/\s+/g, '').toLowerCase();
  const countMatch = normalized.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!countMatch) return undefined;

  const value = Number(countMatch[1]);
  const suffix = countMatch[2];
  const multiplier = suffix === 'b' ? 1_000_000_000 : suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1;
  return Math.round(value * multiplier);
}

// Detect promoted ("Ad" / "Promoted") tweets so thread collection can skip
// them without treating them as the reply boundary. The label lives inside
// the article's User-Name header area (sibling to name/handle/timestamp).
const PROMOTED_LABELS = new Set(
  [
    'promoted',
    'ad',
    'promoted tweet',
    '広告',
    'プロモーション',
    'プロモツイート',
    'werbung',
    'anuncio',
    'patrocinado',
    'promu',
    '广告',
    'إعلان',
    'تبلیغ',
  ].map((l) => l.toLowerCase())
);

export function isPromotedArticle(article: Element): boolean {
  if (article.querySelector('[data-testid="promotedIndicator"]')) return true;
  const userNames = article.querySelectorAll('[data-testid="User-Name"]');
  for (const un of userNames) {
    // Only consider the outer article's header, not a quoted tweet's.
    if (un.closest('[role="link"]')) continue;
    const spans = un.querySelectorAll('span, div');
    for (const el of spans) {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (PROMOTED_LABELS.has(text)) return true;
    }
  }
  return false;
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

function collectMediaFrom(
  scope: Element,
  excludeContainers: Element[] = []
): string[] {
  const out: string[] = [];
  const inExcluded = (el: Element) =>
    excludeContainers.some((c) => c.contains(el));

  const videos = Array.from(scope.querySelectorAll('video')).filter(
    (v) => !inExcluded(v)
  );
  // X often renders BOTH a poster <img> inside tweetPhoto and a hydrated
  // <video poster=…> for the same content — dedupe by poster URL.
  const videoPosters = new Set(
    videos.map((v) => v.getAttribute('poster')).filter((p): p is string => !!p)
  );

  const photos = scope.querySelectorAll(`${SELECTORS.tweetPhoto} img`);
  photos.forEach((img) => {
    if (inExcluded(img)) return;
    let src = (img as HTMLImageElement).src;
    if (!src || src.includes('emoji') || src.includes('profile_images')) return;
    if (videoPosters.has(src)) return;
    if (src.includes('pbs.twimg.com')) {
      src = src.replace(/&name=\w+/, '&name=large');
    }
    out.push(`![Image](${src})`);
  });

  videos.forEach((video) => {
    const poster = video.getAttribute('poster');
    if (poster) {
      out.push(`![🎥 Video](${poster})`);
    }
  });

  return out;
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
  // Containers whose media is owned by the embed, not the main tweet —
  // their media is rendered inside the blockquote (or by the embed itself),
  // and must be excluded from the top-level media list.
  const embedContainers: Element[] = [];

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
      embedContainers.push(quoteContainer);
    }

    const rawQuoteText = extractTextFromElement(quoteEl);
    if (rawQuoteText) {
      const blockquotedText = rawQuoteText.split('\n').join('\n> ');
      embeddedMd = `\n\n> ${quoteAuthorInfo}${blockquotedText}`;
    }

    // Nest quoted-tweet media inside the blockquote so reading order matches X.
    if (quoteContainer) {
      const quotedMedia = collectMediaFrom(quoteContainer);
      if (quotedMedia.length > 0) {
        const nested = quotedMedia.map((m) => `> ${m}`).join('\n> \n');
        embeddedMd += `\n> \n${nested}`;
      }
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
        embedContainers.push(container);
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

      let domain = '';
      let title = '';
      let description = '';

      const mediaBlock = cardWrapper.querySelector(
        '[data-testid="card.layoutSmall.media"], [data-testid="card.layoutLarge.media"]'
      );

      if (detail) {
        // Detail block holds domain / title / description as separate divs.
        const detailDivs = detail.querySelectorAll('div[dir="auto"]');
        for (const d of detailDivs) {
          const t = d.textContent?.trim() || '';
          if (!t) continue;
          if (!domain) domain = t;
          else if (!title) title = t;
          else if (!description) description = t;
        }
      } else {
        // Media-only card: title sits as an overlay inside the media block
        // (often dir="ltr"); the domain isn't rendered inside the wrapper, so
        // derive it from the link's hostname.
        const overlay = mediaBlock?.querySelector('div[dir="ltr"], div[dir="auto"]');
        title = overlay?.textContent?.trim() || '';
        if (href) {
          try {
            domain = new URL(href).hostname.replace(/^www\./, '');
          } catch {
            // leave domain empty if href isn't a parseable URL
          }
        }
      }

      // OG preview image. Alt is the sentinel `Link card preview` so the
      // download-images pass in post-process can leave it as a remote URL —
      // we render it but don't pull it into the local sibling folder.
      let previewImg = '';
      const previewImgEl = mediaBlock?.querySelector('img');
      if (previewImgEl) {
        let src = (previewImgEl as HTMLImageElement).src || '';
        if (src.includes('pbs.twimg.com')) {
          src = src.replace(/&name=\w+/, '&name=large');
        }
        if (src) previewImg = `![Link card preview](${src})`;
      }

      if (title) {
        const parts: string[] = [];
        if (previewImg) parts.push(previewImg);
        if (href) {
          parts.push(`🔗 [**${title}**](${href})`);
        } else {
          parts.push(`🔗 **${title}**`);
        }
        if (description) parts.push(description);
        if (domain) parts.push(`_From ${domain}_`);
        embeddedMd = `\n\n> ${parts.join('\n> \n> ')}`;
        embedContainers.push(cardWrapper);
      }
    }
  }

  const media = collectMediaFrom(article, embedContainers);

  // Place main-tweet media BEFORE the embed so reading order matches X:
  // [main text] → [main media] → [quoted/article/card embed].
  if (embeddedMd && media.length > 0) {
    text += '\n\n' + media.join('\n') + embeddedMd;
    return { text, media: [] };
  }

  text += embeddedMd;
  return { text, media };
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
export async function extractTweetAsync(): Promise<ExtractedContent> {
  const date = extractDate();
  const tweetId = extractTweetId();
  const sourceUrl = window.location.href;

  window.scrollTo({ top: 0, behavior: 'instant' });
  await delay(600);

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

  const firstNonAd =
    Array.from(allArticles).find((a) => !isPromotedArticle(a)) || allArticles[0];
  const threadAuthor = extractAuthorFromArticle(firstNonAd);

  const collected = new Map<string, { text: string; media: string[] }>();
  let threadDone = false;

  const SCROLL_STEP = Math.max(window.innerHeight * 0.6, 400);
  const MAX_STEPS = 60;

  for (let step = 0; step < MAX_STEPS && !threadDone; step++) {
    allArticles = document.querySelectorAll('article[role="article"]');
    const sizeBefore = collected.size;

    for (const article of allArticles) {
      if (isPromotedArticle(article)) continue;
      const articleAuthor = extractAuthorFromArticle(article);
      if (
        articleAuthor.handle.toLowerCase() !==
        threadAuthor.handle.toLowerCase()
      ) {
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

  window.scrollTo({ top: 0, behavior: 'instant' });

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
