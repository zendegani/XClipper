import { delay } from './dom';

/**
 * Wait for the focused tweet's <article> to be in the DOM. For long-form
 * articles also wait until inline images have hydrated (their <a href="/media/">
 * wrappers each contain an <img src>), with a 600 ms stable-count guard against
 * images still streaming in.
 */
export async function waitForArticle(timeoutMs = 15000): Promise<Element | null> {
  const start = Date.now();
  let article: Element | null = null;
  while (Date.now() - start < timeoutMs) {
    article = document.querySelector('article[role="article"]');
    if (article) break;
    await delay(120);
  }
  if (!article) return null;

  const looksLikeLongForm = !!document.querySelector(
    '[data-testid="twitterArticleReadView"], [data-testid="twitterArticleRichTextView"], [data-testid="twitter-article-title"]'
  );
  if (looksLikeLongForm) {
    while (Date.now() - start < timeoutMs) {
      const body =
        document.querySelector('[data-testid="twitterArticleRichTextView"]') ||
        document.querySelector('[data-testid="twitter-article-title"]');
      if (body && body.textContent && body.textContent.trim().length > 0) break;
      await delay(200);
    }
    let lastCount = -1;
    let stableSince = 0;
    while (Date.now() - start < timeoutMs) {
      const body = document.querySelector('[data-testid="twitterArticleRichTextView"]');
      if (!body) break;
      const links = Array.from(body.querySelectorAll('a[href*="/media/"]'));
      const allHydrated =
        links.length === 0 ||
        links.every((l) => {
          const img = l.querySelector('img');
          return !!img && !!img.getAttribute('src');
        });
      if (allHydrated) {
        const imgCount = body.querySelectorAll('img').length;
        if (imgCount === lastCount) {
          if (Date.now() - stableSince >= 600) break;
        } else {
          lastCount = imgCount;
          stableSince = Date.now();
        }
      }
      await delay(200);
    }
  }
  return article;
}
