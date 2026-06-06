// Injects a "Save as Markdown" icon next to the share button in each tweet's
// action bar. Clicking opens the tweet's permalink in a new tab with the
// `#tweet2md=1` marker, which the main content script's bootstrap handles.

const BUTTON_ATTR = 'data-tweet2md-injected';
let decorated = new WeakSet<Element>();

let inlineButtonCopies = false;
let showInlineButton = false;

function removeAllInjectedButtons(): void {
  document.querySelectorAll(`[${BUTTON_ATTR}]`).forEach((btn) => {
    // The button is wrapped in a flex container that we appended to the action bar.
    (btn.parentElement || btn).remove();
  });
  decorated = new WeakSet<Element>();
  articleTopBarDecorated = new WeakSet<Element>();
}

// True until the extension is disabled/reloaded. After that, chrome.* calls
// from this orphaned content script throw "Extension context invalidated".
function extensionAlive(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

function loadInlineMode(): void {
  if (!extensionAlive()) return;
  try {
    chrome.storage.local.get('xclipper_settings', (result) => {
      if (chrome.runtime.lastError) return;
      const s = (result['xclipper_settings'] || {}) as {
        inlineButtonCopies?: boolean;
        showInlineButton?: boolean;
      };
      inlineButtonCopies = s.inlineButtonCopies === true;
      const wasShown = showInlineButton;
      showInlineButton = s.showInlineButton === true; // default false in v2.0.0
      if (wasShown && !showInlineButton) {
        removeAllInjectedButtons();
      } else if (!wasShown && showInlineButton) {
        scan();
      }
    });
  } catch {
    /* extension context gone */
  }
}
loadInlineMode();
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes['xclipper_settings']) return;
    loadInlineMode();
  });
} catch {
  /* extension context gone */
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function buildIcon(): SVGElement {
  // Mirrors X's own action-bar icon style: solid currentColor fill, no stroke.
  // Arrow path is X's share-icon arrow flipped vertically (download direction);
  // tray path is X's share-icon tray unchanged — it works as a "catch" tray.
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.width = '1.25em';
  svg.style.height = '1.25em';
  svg.style.display = 'block';
  svg.style.fill = 'currentColor';

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute(
    'd',
    'M12 16l5.7-5.7-1.41-1.42L13 12.18V2.59h-2V12.18l-3.3-3.3-1.41 1.42L12 16zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z'
  );
  svg.appendChild(path);

  return svg;
}

function normalizeStatusUrl(url: string): string | null {
  const m = url.match(/^(https?:\/\/(?:www\.)?x\.com\/[^/]+\/status\/\d+)/);
  return m ? m[1] : null;
}

function getStatusUrl(article: Element): string | null {
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

function openWithMarker(
  url: string,
  action: 'download' | 'copy',
  single: boolean
): void {
  const sep = url.includes('#') ? '&' : '#';
  const singleSuffix = single ? '&tweet2md_single=1' : '';
  window.open(url + sep + 'tweet2md=' + action + singleSuffix, '_blank', 'noopener');
}

// If the target tweet is the current page, extract in place rather than
// opening a duplicate tab. Otherwise fall through to the new-tab flow.
function triggerExtract(
  url: string,
  action: 'download' | 'copy',
  single: boolean
): void {
  const target = normalizeStatusUrl(url);
  const page = normalizeStatusUrl(window.location.href);
  if (target && page && target === page) {
    window.dispatchEvent(
      new CustomEvent('tweet2md:autoextract', { detail: { action, single } })
    );
    return;
  }
  openWithMarker(url, action, single);
}

function singleFromEvent(e: Event): boolean {
  const me = e as MouseEvent | KeyboardEvent;
  return me.shiftKey === true || me.altKey === true;
}

function makeButton(onClick: (e: Event) => void): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.setAttribute(BUTTON_ATTR, '1');
  wrapper.setAttribute('role', 'button');
  wrapper.setAttribute('tabindex', '0');
  wrapper.setAttribute('aria-label', 'Save as Markdown');
  wrapper.title = 'Save as Markdown (XClipper)\nShift/Alt-click: just this tweet';
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
    // Restore the per-context color measured from X's sibling icon, falling
    // back to the timeline gray if measurement hasn't happened yet.
    wrapper.style.color = wrapper.dataset.idleColor || 'rgb(113,118,123)';
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

// X renders icons at different sizes and slightly different gray values
// depending on context (focused tweet vs timeline, light vs dark theme).
// Measure a sibling icon's actual rendered size and fill, and pin ours to
// match — that way the inline button looks native in every surface X uses.
function matchSiblingIcon(
  actionBar: Element,
  wrapper: HTMLElement,
  ourSvg: SVGElement | null
): void {
  if (!ourSvg) return;
  const ref = Array.from(actionBar.querySelectorAll('svg')).find(
    (s) => !s.closest(`[${BUTTON_ATTR}]`)
  );
  if (!ref) return;
  const r = ref.getBoundingClientRect();
  if (r.width > 0) {
    ourSvg.style.width = `${r.width}px`;
    ourSvg.style.height = `${r.height}px`;
  }
  const fill = getComputedStyle(ref).fill;
  if (fill && fill !== 'none') {
    // Drive both idle and hover via currentColor on the wrapper.
    wrapper.dataset.idleColor = fill;
    wrapper.style.color = fill;
  }
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

  const btn = makeButton((e) => {
    const fresh = getStatusUrl(article) || url;
    triggerExtract(
      fresh,
      inlineButtonCopies ? 'copy' : 'download',
      singleFromEvent(e)
    );
  });
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;align-items:center;';
  container.appendChild(btn);
  actionBar.appendChild(container);

  matchSiblingIcon(actionBar, btn, btn.querySelector('svg'));

  decorated.add(article);
}

// On article (long-form) pages, X renders a top action bar above the content.
// Inject the same button there so users don't have to scroll past long articles.
let articleTopBarDecorated = new WeakSet<Element>();
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

  const btn = makeButton((e) =>
    triggerExtract(
      window.location.href,
      inlineButtonCopies ? 'copy' : 'download',
      singleFromEvent(e)
    )
  );
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;align-items:center;';
  container.appendChild(btn);
  candidate.appendChild(container);
  matchSiblingIcon(candidate, btn, btn.querySelector('svg'));
  articleTopBarDecorated.add(candidate);
}

let scanScheduled = false;
function scan(): void {
  if (!showInlineButton) return;
  const articles = document.querySelectorAll('article[role="article"]');
  articles.forEach(decorateArticleActionBar);
  decorateArticleTopBar();
}

const observer = new MutationObserver(() => {
  if (!extensionAlive()) {
    observer.disconnect();
    return;
  }
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
  if (!extensionAlive()) return;
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
  try {
    chrome.runtime.sendMessage({ action: 'TWEET2MD_CTX_URL', url }, () => {
      // Read lastError to suppress "Unchecked runtime.lastError" log when the
      // background hasn't registered the listener yet or context is gone.
      void chrome.runtime.lastError;
    });
  } catch {
    /* extension context gone */
  }
}, true);
