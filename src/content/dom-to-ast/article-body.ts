import type {
  Document,
  ArticleNode,
  Block,
  TweetNode,
  ImageNode,
  HeadingNode,
  ListNode,
  ListItemNode,
  CodeBlockNode,
  ParagraphNode,
  ThematicBreakNode,
} from '../../ast/types';
import { SELECTORS, extractAuthor, extractDate, extractTweetId } from '../dom';
import { extractEngagementMetadata } from '../tweet';
import { hostMatches } from '../../shared/media';
import { stripHandlePrefix } from './shared';
import { extractArticleInline } from './inline';
import { extractArticleCard } from './cards';
import { articleToTweetNode } from './tweet-node';

export function articleDocument(): Document {
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

  // Embedded X Article card — emit as ArticleCardNode. Must run BEFORE the
  // simpleTweet branch below, because article-card blocks are also wrapped
  // in simpleTweet markup and that branch would short-circuit to a profile
  // thumbnail (losing banner + title + description).
  if (block.querySelector('[data-testid="article-cover-image"]')) {
    const card = extractArticleCard(block);
    return card ? [card] : [];
  }

  // X article images are wrapped in an article media permalink. Caption text
  // can live in the same block, so textContent is not a reliable image-only
  // signal here.
  const articleMediaImg = findArticleMediaImage(block);
  if (articleMediaImg) {
    return [articleMediaImg];
  }

  // Embedded simpleTweet card — X Articles can contain full tweet embeds in
  // the article body. Preserve the tweet structure instead of collapsing the
  // card to its avatar image.
  if (block.querySelector('[data-testid="simpleTweet"]')) {
    const tweet = extractSimpleTweet(block);
    if (tweet) return [tweet];
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

function extractSimpleTweet(block: HTMLElement): TweetNode | undefined {
  const tweetArticle = block.querySelector('[data-testid="simpleTweet"] article[role="article"]')
    || block.querySelector('[data-testid="simpleTweet"] [data-testid="tweet"]');
  if (!tweetArticle) return undefined;
  return articleToTweetNode(tweetArticle);
}

function findArticleBlockImage(block: HTMLElement): ImageNode | undefined {
  const imgEl = block.querySelector('img') as HTMLImageElement | null;
  return imageNodeFromElement(imgEl);
}

function findArticleMediaImage(block: HTMLElement): ImageNode | undefined {
  const mediaLink = block.querySelector('a[href*="/article/"][href*="/media/"], a[href*="/media/"]');
  if (!mediaLink) return undefined;
  const imgEl = mediaLink.querySelector('img') as HTMLImageElement | null;
  if (!imgEl) return undefined;
  const src = imgEl.src || '';
  if (!hostMatches(src, 'pbs.twimg.com') || src.includes('profile_images')) return undefined;
  return imageNodeFromElement(imgEl);
}

function imageNodeFromElement(imgEl: HTMLImageElement | null): ImageNode | undefined {
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
