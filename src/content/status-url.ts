// Canonicalize an x.com status permalink and locate one on a tweet <article>.
// A shared content-script leaf: the injector (button placement, harvest, context
// menu) and selection mode both need it, so it lives here to keep either from
// importing the other.

export function normalizeStatusUrl(url: string): string | null {
  const m = url.match(/^(https?:\/\/(?:www\.)?x\.com\/[^/]+\/status\/\d+)/);
  return m ? m[1] : null;
}

export function getStatusUrl(article: Element): string | null {
  // On a /status/<id> permalink page, the URL bar is authoritative for the
  // *outer* tweet. The article DOM may contain a quoted tweet whose own
  // <time> link appears earlier in DOM order than the main tweet's — picking
  // the first time-link there would return the quoted tweet's URL.
  // So if the article element references the page's status id anywhere, trust
  // the URL bar instead of walking the DOM.
  if (window.location.pathname.includes('/status/')) {
    const pageUrl = normalizeStatusUrl(window.location.href);
    const id = pageUrl?.match(/status\/(\d+)/)?.[1];
    if (pageUrl && id && article.querySelector(`a[href*="/status/${id}"]`)) {
      return pageUrl;
    }
  }

  const timeLink = article.querySelector('a[href*="/status/"] time');
  const a = timeLink?.closest('a') as HTMLAnchorElement | null;
  if (a?.href) {
    const norm = normalizeStatusUrl(a.href);
    if (norm) return norm;
  }
  const anyStatus = article.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;
  return anyStatus?.href ? normalizeStatusUrl(anyStatus.href) : null;
}
