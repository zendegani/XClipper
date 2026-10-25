import type { AuthorInfo } from '../../ast/types';
import { SELECTORS } from '../dom';

export function stripHandlePrefix(a: { name: string; handle: string }): AuthorInfo {
  return {
    name: a.name,
    handle: a.handle.startsWith('@') ? a.handle.slice(1) : a.handle,
  };
}

// X previews every post on a permalink except the requested one: the text
// stops at about 280 characters and a "Show more" button follows it. The
// button opens the post's own page; it doesn't expand the text in place.
export function isTextTruncated(textEl: Element): boolean {
  return textEl.nextElementSibling?.matches(SELECTORS.readMore) === true;
}

export function extractDateFromArticle(article: Element): string {
  const timeEl = article.querySelector('time');
  if (timeEl) {
    const datetime = timeEl.getAttribute('datetime');
    if (datetime) return datetime;
    return timeEl.textContent?.trim() || '';
  }
  return '';
}
