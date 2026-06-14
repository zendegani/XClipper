// Injects a "Save as Markdown" icon next to the share button in each tweet's
// action bar. Clicking opens the tweet's permalink in a new tab with the
// `#xclipper=1` marker, which the main content script's bootstrap handles.

const BUTTON_ATTR = 'data-xclipper-injected';
let decorated = new WeakSet<Element>();

let inlineButtonCopies = false;
let showInlineButton = false;
let includeReposts = false; // profile batch: keep reposts too (default off)

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
        includeReposts?: boolean;
      };
      includeReposts = s.includeReposts === true;
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
  const singleSuffix = single ? '&xclipper_single=1' : '';
  window.open(url + sep + 'xclipper=' + action + singleSuffix, '_blank', 'noopener');
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
      new CustomEvent('xclipper:autoextract', { detail: { action, single } })
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

// ─── Timeline harvester (ADR 0002, Phases B–C) ───────────────────────
// X virtualizes timelines — cells scrolled past are detached from the DOM —
// so "what's in the DOM" is not "what the user has loaded". Accumulate
// permalinks as cells pass through, in encounter order (top first); the
// popup asks for the set when starting a batch export. Sources: the
// bookmarks page, profile pages (where reposts are skipped by keeping only
// the owner's own /<handle>/status/ links), and the Likes page (which keeps
// every author, since likes are of other people's posts). The set resets
// when the source changes, so a later visit doesn't export items removed
// meanwhile.

// Top-level x.com paths that are app surfaces, not profile handles.
const NON_PROFILE_PATHS = new Set([
  'home', 'explore', 'notifications', 'messages', 'settings', 'search',
  'compose', 'jobs', 'communities', 'premium', 'verified-orgs', 'about',
  'tos', 'privacy', 'login', 'logout', 'signup', 'share', 'intent',
  'hashtag', 'places', 'topics', 'account', 'follower_requests',
]);

type HarvestSource =
  | { kind: 'bookmarks'; key: string }
  | { kind: 'profile'; key: string; handle: string }
  | { kind: 'likes'; key: string; handle: string }
  | { kind: 'timeline'; key: string }
  | null;

function harvestSourceOfPage(): HarvestSource {
  const path = window.location.pathname;
  if (path.startsWith('/i/bookmarks')) return { kind: 'bookmarks', key: 'bookmarks' };
  // Home feed shows tweets by many authors (like Likes) — keep every author's
  // permalink (no repost filter, which only applies to a profile).
  if (path === '/home') return { kind: 'timeline', key: 'timeline' };
  // Likes live at /<handle>/likes and show tweets by many authors (the ones
  // the user liked) — so, unlike a profile, we keep every author's permalink.
  const liked = path.match(/^\/([A-Za-z0-9_]{1,15})\/likes$/);
  if (liked && !NON_PROFILE_PATHS.has(liked[1].toLowerCase())) {
    return { kind: 'likes', key: `likes:${liked[1].toLowerCase()}`, handle: liked[1] };
  }
  const m = path.match(/^\/([A-Za-z0-9_]{1,15})$/);
  if (m && !NON_PROFILE_PATHS.has(m[1].toLowerCase())) {
    return { kind: 'profile', key: `profile:${m[1].toLowerCase()}`, handle: m[1] };
  }
  return null;
}

const harvested = new Set<string>();
let harvestKey = '';

function harvestTimeline(): HarvestSource {
  const source = harvestSourceOfPage();
  if (!source) {
    if (harvestKey) {
      harvested.clear();
      harvestKey = '';
    }
    return null;
  }
  if (source.key !== harvestKey) {
    harvested.clear();
    harvestKey = source.key;
  }
  for (const article of document.querySelectorAll('article[role="article"]')) {
    const url = getStatusUrl(article);
    if (!url) continue;
    if (source.kind === 'profile' && !includeReposts) {
      // Repost cells link to the original author's permalink — skip them so
      // a profile export contains the profile owner's own posts.
      const author = url.match(/x\.com\/([^/]+)\/status\//)?.[1] || '';
      if (author.toLowerCase() !== source.handle.toLowerCase()) continue;
    }
    harvested.add(url);
  }
  return source;
}

// ─── Selection mode (ADR 0002, Phase C) ──────────────────────────────
// Toggled from the popup on any timeline: overlay a check mark on each tweet
// cell and a floating bar with the count + Export. Selection is keyed by
// permalink, so it survives X's cell virtualization; checks are re-painted
// by the mutation observer as cells re-mount.

const SELECT_MARK_ATTR = 'data-xclipper-select';
const SELECTED_ATTR = 'data-xclipper-selected';
const ACCENT = 'rgb(14,165,233)';

let selectionMode = false;
const selectedUrls = new Set<string>();
let selectionBar: HTMLElement | null = null;
let selectionCountEl: HTMLElement | null = null;

function syncMark(mark: HTMLElement, selected: boolean): void {
  mark.textContent = selected ? '✓' : '';
  mark.style.background = selected ? ACCENT : 'rgba(15,20,25,0.55)';
  mark.style.borderColor = selected ? ACCENT : '#fff';
}

function decorateSelection(): void {
  if (!selectionMode) return;
  for (const article of document.querySelectorAll('article[role="article"]')) {
    const url = getStatusUrl(article);
    if (!url) continue;
    let mark = article.querySelector(`[${SELECT_MARK_ATTR}]`) as HTMLElement | null;
    if (!mark) {
      const host = article as HTMLElement;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      mark = document.createElement('div');
      mark.setAttribute(SELECT_MARK_ATTR, '1');
      mark.style.cssText = [
        'position:absolute',
        'top:10px',
        'right:10px',
        'width:22px',
        'height:22px',
        'border-radius:9999px',
        'border:2px solid #fff',
        'box-shadow:0 1px 4px rgba(0,0,0,0.4)',
        'color:#fff',
        'font:700 14px/18px system-ui,sans-serif',
        'text-align:center',
        'cursor:pointer',
        'z-index:10',
        'user-select:none',
      ].join(';');
      mark.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const fresh = getStatusUrl(article) || url;
        if (selectedUrls.has(fresh)) {
          selectedUrls.delete(fresh);
          article.removeAttribute(SELECTED_ATTR);
        } else {
          selectedUrls.add(fresh);
          article.setAttribute(SELECTED_ATTR, '1');
        }
        syncMark(mark as HTMLElement, selectedUrls.has(fresh));
        updateSelectionBar();
      });
      article.appendChild(mark);
    }
    // Cells get recycled by the virtualizer — re-sync visuals from state.
    const isSelected = selectedUrls.has(url);
    syncMark(mark, isSelected);
    if (isSelected) article.setAttribute(SELECTED_ATTR, '1');
    else article.removeAttribute(SELECTED_ATTR);
  }
}

function updateSelectionBar(): void {
  if (!selectionCountEl) return;
  // Lead with an instruction so it's obvious what mode this is; switch to the
  // running count once the user starts picking tweets.
  selectionCountEl.textContent =
    selectedUrls.size === 0
      ? chrome.i18n.getMessage('batch_bar_hint') || 'Tap tweets to select'
      : `${selectedUrls.size} ${chrome.i18n.getMessage('batch_bar_selected') || 'selected'}`;
}

function barButton(label: string, solid: boolean, onClick: () => void): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.style.cssText = [
    'font:600 14px/1 system-ui,sans-serif',
    'padding:10px 18px',
    'border-radius:10px',
    'cursor:pointer',
    'white-space:nowrap',
    solid ? `background:${ACCENT};border:1px solid ${ACCENT};color:#fff`
          : 'background:transparent;border:1px solid rgba(255,255,255,0.5);color:#fff',
  ].join(';');
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function enterSelection(): void {
  if (selectionMode) return;
  selectionMode = true;

  selectionBar = document.createElement('div');
  selectionBar.style.cssText = [
    'position:fixed',
    'bottom:28px',
    'left:50%',
    // Size to content (and cap to the viewport) so the centered bar never
    // wraps to two lines — a fixed box at left:50% otherwise shrink-fits to
    // only half the viewport width.
    'width:max-content',
    'max-width:calc(100vw - 24px)',
    // Start a touch lower and transparent so the bar slides up into view
    // (revealed via requestAnimationFrame below) instead of appearing
    // silently where a scrolling user wouldn't notice it.
    'transform:translateX(-50%) translateY(16px)',
    'opacity:0',
    'transition:opacity .22s ease, transform .22s ease',
    'display:flex',
    'align-items:center',
    'gap:14px',
    'background:rgba(15,20,25,0.97)',
    'color:#fff',
    'padding:14px 20px',
    'border-radius:14px',
    // Accent ring + deep shadow so it stands clear of the timeline.
    `box-shadow:0 8px 28px rgba(0,0,0,0.45), 0 0 0 1px ${ACCENT}`,
    'z-index:2147483647',
    'font:600 15px/1.2 system-ui,sans-serif',
  ].join(';');

  selectionCountEl = document.createElement('span');
  selectionBar.appendChild(selectionCountEl);
  selectionBar.appendChild(
    barButton(chrome.i18n.getMessage('batch_bar_export') || 'Export', true, () => {
      if (selectedUrls.size === 0) return;
      try {
        chrome.runtime.sendMessage(
          { action: 'BATCH_START', urls: Array.from(selectedUrls), origin: 'selection' },
          (resp) => {
            void chrome.runtime.lastError;
            if (resp?.success) {
              if (selectionCountEl) {
                selectionCountEl.textContent =
                  chrome.i18n.getMessage('batch_started') || 'Batch started';
              }
              setTimeout(exitSelection, 1200);
            } else if (selectionCountEl) {
              selectionCountEl.textContent = resp?.error || 'Could not start the batch.';
            }
          }
        );
      } catch {
        /* extension context gone */
      }
    })
  );
  selectionBar.appendChild(barButton('✕', false, exitSelection));
  document.body.appendChild(selectionBar);

  updateSelectionBar();
  decorateSelection();

  // Next frame: animate from the hidden initial state into view.
  requestAnimationFrame(() => {
    if (!selectionBar) return;
    selectionBar.style.opacity = '1';
    selectionBar.style.transform = 'translateX(-50%) translateY(0)';
  });
}

function exitSelection(): void {
  selectionMode = false;
  selectedUrls.clear();
  document.querySelectorAll(`[${SELECT_MARK_ATTR}]`).forEach((m) => m.remove());
  document.querySelectorAll(`[${SELECTED_ATTR}]`).forEach((a) => a.removeAttribute(SELECTED_ATTR));
  selectionBar?.remove();
  selectionBar = null;
  selectionCountEl = null;
}

try {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.action === 'XCLIPPER_HARVEST') {
      const source = harvestTimeline(); // catch cells rendered since the last mutation
      sendResponse({
        source: source ? source.kind : null,
        ...(source?.kind === 'profile' ? { handle: source.handle } : {}),
        urls: Array.from(harvested),
      });
      return false;
    }
    if (msg && msg.action === 'XCLIPPER_HARVEST_RESET') {
      // Drop everything gathered so far, then re-seed from the current viewport
      // so the collection restarts at wherever the user has scrolled to.
      harvested.clear();
      harvestTimeline();
      sendResponse({ count: harvested.size });
      return false;
    }
    if (msg && msg.action === 'XCLIPPER_SELECTION') {
      if (msg.enable) enterSelection();
      else exitSelection();
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
} catch {
  /* extension context gone */
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
    harvestTimeline();
    decorateSelection();
  });
});

observer.observe(document.body, { childList: true, subtree: true });
scan();
harvestTimeline();

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
    chrome.runtime.sendMessage({ action: 'XCLIPPER_CTX_URL', url }, () => {
      // Read lastError to suppress "Unchecked runtime.lastError" log when the
      // background hasn't registered the listener yet or context is gone.
      void chrome.runtime.lastError;
    });
  } catch {
    /* extension context gone */
  }
}, true);
