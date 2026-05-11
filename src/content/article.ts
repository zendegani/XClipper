import type { ExtractedContent } from '../types/messages';
import {
  SELECTORS,
  extractAuthor,
  extractDate,
  extractTweetId,
} from './dom';

function isInlineLinkWrapper(el: HTMLElement): boolean {
  // Draft.js content blocks are NOT inline link wrappers
  if (el.hasAttribute('data-offset-key')) return false;
  if (el.className.includes('DraftStyleDefault')) return false;
  if (el.className.includes('longform-')) return false;

  const childElements = Array.from(el.children);
  const hasOnlyLink = childElements.length === 1 && childElements[0].tagName === 'A';
  const hasLink = childElements.some(c => c.tagName === 'A' || c.querySelector('a'));

  if (hasOnlyLink) return true;

  let textLen = 0;
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      textLen += (child.textContent || '').trim().length;
    }
  }

  return hasLink && textLen === 0 && childElements.length <= 2;
}

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

    if (elem.tagName === 'IMG') {
      const md = extractImageMd(elem as HTMLImageElement);
      if (md) result += md;
      continue;
    }

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
      // Emit just the image markdown so the popup's localization regex picks it up.
      const innerImg = anchor.querySelector('img') as HTMLImageElement | null;
      if (innerImg && !linkText) {
        const md = extractImageMd(innerImg);
        if (md) result += md;
        continue;
      }
      result += `[${linkText}](${fullHref})`;
      continue;
    }

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

    result += extractInlineText(elem);
  }

  return result;
}

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
export function extractArticle(): ExtractedContent {
  const author = extractAuthor();
  const date = extractDate();
  const tweetId = extractTweetId();
  const sourceUrl = window.location.href;

  let title: string | undefined;
  const titleEl = document.querySelector(SELECTORS.articleTitle);
  if (titleEl) {
    title = titleEl.textContent?.trim();
  }

  let bannerImageMd = '';
  const articleEl = document.querySelector('article[role="article"]');
  if (articleEl) {
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
        if (src.includes('pbs.twimg.com')) {
          src = src.replace(/&name=\w+/, '&name=large');
        }
        bannerImageMd = `![Banner](${src})`;
      }
    }
  }

  const richTextView = document.querySelector(SELECTORS.articleRichText);
  if (!richTextView) {
    throw new Error(
      'Could not find the article body. The page may not have fully loaded.'
    );
  }

  const mdParts: string[] = [];
  const draftContent =
    richTextView.querySelector(SELECTORS.articleDraftContent) || richTextView;

  const dataContents =
    draftContent.querySelector('[data-contents]') || draftContent;
  const blocks = dataContents.children;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i] as HTMLElement;

    // Code block MUST be checked before separator — both use <section>
    const codeBlock = block.querySelector('[data-testid="markdown-code-block"]');
    if (codeBlock || block.getAttribute('data-testid') === 'markdown-code-block') {
      const cb = codeBlock || block;
      const codeEl = cb.querySelector('code');
      const langFromClass = codeEl?.className?.match(/language-(\w+)/)?.[1] || '';
      const langLabel = cb.querySelector('[class*="r-1aiqnjv"]');
      const lang = langFromClass || langLabel?.textContent?.trim() || '';
      const preEl = cb.querySelector('pre');
      const codeSource = preEl?.querySelector('code') || preEl;
      const codeText = codeSource?.textContent || '';
      mdParts.push('', `\`\`\`${lang}`, codeText.trimEnd(), '\`\`\`', '');
      continue;
    }

    if (block.querySelector('[role="separator"]')) {
      mdParts.push('', '---', '');
      continue;
    }

    const h1 = block.querySelector('.longform-header-one') ||
               (block.classList.contains('longform-header-one') ? block : null);
    if (h1 || block.querySelector('h1.longform-header-one')) {
      const heading = block.textContent?.trim() || '';
      if (heading) mdParts.push('', `# ${heading}`, '');
      continue;
    }

    const h2 = block.querySelector('.longform-header-two') ||
               (block.classList.contains('longform-header-two') ? block : null);
    if (h2 || block.querySelector('h2.longform-header-two')) {
      const heading = block.textContent?.trim() || '';
      if (heading) mdParts.push('', `## ${heading}`, '');
      continue;
    }

    if (block.tagName === 'UL') {
      const items = block.querySelectorAll('.longform-unordered-list-item');
      items.forEach((li) => {
        const text = extractInlineText(li);
        if (text) mdParts.push(`- ${text}`);
      });
      mdParts.push('');
      continue;
    }

    if (block.classList.contains('longform-unordered-list-item')) {
      const text = extractInlineText(block);
      if (text) mdParts.push(`- ${text}`);
      mdParts.push('');
      continue;
    }

    if (block.tagName === 'OL') {
      const items = block.querySelectorAll('li');
      items.forEach((li, idx) => {
        const text = extractInlineText(li);
        if (text) mdParts.push(`${idx + 1}. ${text}`);
      });
      mdParts.push('');
      continue;
    }

    const text = extractInlineText(block);
    if (text) {
      mdParts.push(text, '');
    } else if (block.textContent?.trim() === '') {
      mdParts.push('');
    }
  }

  let bodyMarkdown = mdParts.join('\n').replace(/\n{3,}/g, '\n\n').trim();

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
