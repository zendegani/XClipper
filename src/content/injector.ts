// Injects a "Save as Markdown" icon next to the share button in each tweet's
// action bar. Clicking opens the tweet's permalink in a new tab with the
// `#tweet2md=1` marker, which the main content script's bootstrap handles.

const BUTTON_ATTR = 'data-tweet2md-injected';
const decorated = new WeakSet<Element>();

let inlineButtonCopies = false;

function loadInlineMode(): void {
  chrome.storage.local.get('tweet2md_settings', (result) => {
    const s = (result['tweet2md_settings'] || {}) as { inlineButtonCopies?: boolean };
    inlineButtonCopies = s.inlineButtonCopies === true;
  });
}
loadInlineMode();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes['tweet2md_settings']) return;
  loadInlineMode();
});

const SVG_NS = 'http://www.w3.org/2000/svg';

function buildIcon(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.style.width = '1.25em';
  svg.style.height = '1.25em';
  svg.style.display = 'block';

  const tray = document.createElementNS(SVG_NS, 'path');
  tray.setAttribute('d', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4');
  svg.appendChild(tray);

  const arrowHead = document.createElementNS(SVG_NS, 'polyline');
  arrowHead.setAttribute('points', '7 10 12 15 17 10');
  svg.appendChild(arrowHead);

  const arrowShaft = document.createElementNS(SVG_NS, 'line');
  arrowShaft.setAttribute('x1', '12');
  arrowShaft.setAttribute('y1', '15');
  arrowShaft.setAttribute('x2', '12');
  arrowShaft.setAttribute('y2', '3');
  svg.appendChild(arrowShaft);

  return svg;
}

function normalizeStatusUrl(url: string): string | null {
  const m = url.match(/^(https?:\/\/(?:www\.)?x\.com\/[^/]+\/status\/\d+)/);
  return m ? m[1] : null;
}

function getStatusUrl(article: Element): string | null {
  const timeLink = article.querySelector('a[href*="/status/"] time');
  const a = timeLink?.closest('a') as HTMLAnchorElement | null;
  if (a?.href) {
    const norm = normalizeStatusUrl(a.href);
    if (norm) return norm;
  }
  const anyStatus = article.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;
  return anyStatus?.href ? normalizeStatusUrl(anyStatus.href) : null;
}

function openWithMarker(url: string, action: 'download' | 'copy'): void {
  const sep = url.includes('#') ? '&' : '#';
  window.open(url + sep + 'tweet2md=' + action, '_blank', 'noopener');
}

function makeButton(onClick: (e: Event) => void): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.setAttribute(BUTTON_ATTR, '1');
  wrapper.setAttribute('role', 'button');
  wrapper.setAttribute('tabindex', '0');
  wrapper.setAttribute('aria-label', 'Save as Markdown');
  wrapper.title = 'Save as Markdown (tweet2md)';
  wrapper.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'cursor:pointer',
    'color:rgb(113,118,123)',
    'padding:8px',
    'border-radius:9999px',
    'transition:background-color 0.15s,color 0.15s',
    'user-select:none',
  ].join(';');
  wrapper.appendChild(buildIcon());

  wrapper.addEventListener('mouseenter', () => {
    wrapper.style.backgroundColor = 'rgba(29,155,240,0.1)';
    wrapper.style.color = 'rgb(29,155,240)';
  });
  wrapper.addEventListener('mouseleave', () => {
    wrapper.style.backgroundColor = '';
    wrapper.style.color = 'rgb(113,118,123)';
  });

  const handler = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    onClick(e);
  };
  wrapper.addEventListener('click', handler);
  wrapper.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') handler(e);
  });

  return wrapper;
}

function decorateArticleActionBar(article: Element): void {
  if (decorated.has(article)) return;

  const actionBar = article.querySelector('div[role="group"][id^="id__"]')
    || article.querySelector('div[role="group"]');
  if (!actionBar) return;
  if (actionBar.querySelector(`[${BUTTON_ATTR}]`)) {
    decorated.add(article);
    return;
  }

  const url = getStatusUrl(article);
  if (!url) return;

  const btn = makeButton(() => {
    const fresh = getStatusUrl(article) || url;
    openWithMarker(fresh, inlineButtonCopies ? 'copy' : 'download');
  });
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;align-items:center;';
  container.appendChild(btn);
  actionBar.appendChild(container);

  decorated.add(article);
}

// On article (long-form) pages, X renders a top action bar above the content.
// Inject the same button there so users don't have to scroll past long articles.
const articleTopBarDecorated = new WeakSet<Element>();
function decorateArticleTopBar(): void {
  if (!window.location.pathname.includes('/status/')) return;
  const articleBody = document.querySelector('[data-testid="twitterArticleRichTextView"]')
    || document.querySelector('[data-testid="twitter-article-title"]');
  if (!articleBody) return;

  let candidate: Element | null = null;
  let cursor: Element | null = articleBody;
  for (let i = 0; cursor && i < 8; i++) {
    const groups = cursor.parentElement?.querySelectorAll('div[role="group"]');
    if (groups && groups.length) {
      candidate = groups[0];
      break;
    }
    cursor = cursor.parentElement;
  }
  if (!candidate) return;
  if (articleTopBarDecorated.has(candidate)) return;
  if (candidate.querySelector(`[${BUTTON_ATTR}]`)) {
    articleTopBarDecorated.add(candidate);
    return;
  }

  const btn = makeButton(() => openWithMarker(window.location.href, inlineButtonCopies ? 'copy' : 'download'));
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;align-items:center;';
  container.appendChild(btn);
  candidate.appendChild(container);
  articleTopBarDecorated.add(candidate);
}

let scanScheduled = false;
function scan(): void {
  const articles = document.querySelectorAll('article[role="article"]');
  articles.forEach(decorateArticleActionBar);
  decorateArticleTopBar();
}

const observer = new MutationObserver(() => {
  if (scanScheduled) return;
  scanScheduled = true;
  requestAnimationFrame(() => {
    scanScheduled = false;
    scan();
  });
});

observer.observe(document.body, { childList: true, subtree: true });
scan();

// ─── Right-click tracking ────────────────────────────────────────────
// On context menu open, find the closest tweet article and tell the background
// service worker its permalink. The background uses this as the fallback URL
// when the user picks the menu item over an area that isn't a status link.

document.addEventListener('contextmenu', (e) => {
  const target = e.target as Element | null;
  const article = target?.closest?.('article[role="article"]') as Element | null;
  let url: string | null = null;
  if (article) {
    url = getStatusUrl(article);
  } else if (window.location.pathname.includes('/status/')) {
    // On a permalink page where no article is under the cursor, fall back to
    // the page URL itself.
    url = window.location.href;
  }
  chrome.runtime.sendMessage({ action: 'TWEET2MD_CTX_URL', url });
}, true);
