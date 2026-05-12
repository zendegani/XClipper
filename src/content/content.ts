import type { DownloadRequest, ExtractResponse } from '../types/messages';
import { postProcess, resolveDownloadImages } from '../shared/post-process';
import { delay, isArticlePage } from './dom';
import { extractArticle } from './article';
import {
  extractTweetAsync,
  extractEngagementMetadata,
  findTweetArticleByStatusId,
} from './tweet';
import { waitForArticle } from './wait';

// ─── Main Extraction Entry Point ────────────────────────────────────

export async function extract(options?: {
  includeMetadata?: boolean;
}): Promise<ExtractResponse> {
  try {
    if (!window.location.pathname.includes('/status/')) {
      return {
        success: false,
        error: 'Not on an X.com status page. Navigate to a tweet or article first.',
      };
    }

    const isArticle = isArticlePage();
    const data = isArticle ? extractArticle() : await extractTweetAsync();

    if (options?.includeMetadata && !data.metadata) {
      const metadataArticle = isArticle
        ? document.querySelector('article[role="article"]')
        : findTweetArticleByStatusId(data.tweetId) ||
          document.querySelector('article[role="article"]');
      if (metadataArticle) {
        data.metadata = extractEngagementMetadata(metadataArticle);
      }
    }

    return { success: true, data };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Message Listener ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
  if (_message.action === 'EXTRACT') {
    extract({
      includeMetadata: _message.includeMetadata || false,
    }).then(sendResponse);
  }
  return true; // keep channel open for async sendResponse
});

// ─── Auto-extract bootstrap (#tweet2md=download | #tweet2md=copy) ───
// Triggered when the page is opened from the inline button or context menu.

const AUTO_MARKER_RE = /[#&]tweet2md=(download|copy|1)/;

interface StoredSettings {
  downloadImages?: boolean;
  includeMetadata?: boolean;
  closeTabAfterExport?: boolean;
  inlineStats?: boolean;
}

function loadStoredSettings(): Promise<StoredSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get('tweet2md_settings', (result) => {
      resolve((result['tweet2md_settings'] as StoredSettings) || {});
    });
  });
}

let autoExtractInFlight = false;

async function autoExtract(
  action: 'download' | 'copy',
  opts: { allowClose?: boolean } = {}
): Promise<void> {
  if (autoExtractInFlight) return;
  autoExtractInFlight = true;
  try {
    await runAutoExtract(action, opts);
  } finally {
    autoExtractInFlight = false;
  }
}

async function runAutoExtract(
  action: 'download' | 'copy',
  opts: { allowClose?: boolean }
): Promise<void> {
  const allowClose = opts.allowClose !== false;

  // Strip the marker from the URL so refreshes don't re-trigger.
  try {
    const cleanHash = window.location.hash
      .replace(/[#&]tweet2md=(?:download|copy|1)/g, '')
      .replace(/^#$/, '');
    history.replaceState(null, '', window.location.pathname + window.location.search + (cleanHash || ''));
  } catch {
    // history API may be unavailable in some contexts; ignore
  }

  const article = await waitForArticle();
  if (!article) return;

  const settings = await loadStoredSettings();
  const includeMetadata = settings.includeMetadata !== false; // default on
  const inlineStats = settings.inlineStats === true;
  const downloadImages = resolveDownloadImages(action, settings.downloadImages === true);
  const shouldClose = allowClose && settings.closeTabAfterExport === true;

  // Need engagement data if either renderer wants it.
  const response = await extract({ includeMetadata: includeMetadata || inlineStats });
  if (!response.success || !response.data) return;

  const result = postProcess(response.data, { includeMetadata, downloadImages, inlineStats });

  if (action === 'copy') {
    try {
      await navigator.clipboard.writeText(result.markdown);
    } catch {
      // Clipboard access may be denied if the tab isn't focused; fall back to
      // a hidden textarea + execCommand.
      const ta = document.createElement('textarea');
      ta.value = result.markdown;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
  } else {
    const downloadMsg: DownloadRequest = {
      action: 'DOWNLOAD_MD',
      content: result.markdown,
      filename: result.filename,
      images: result.images.length > 0 ? result.images : undefined,
    };
    await new Promise<void>((resolve) => {
      chrome.runtime.sendMessage(downloadMsg, () => resolve());
    });
  }

  // In-place runs (inline button / context menu on the current page) get a
  // brief toast since there's no popup UI or new tab to provide feedback.
  if (!allowClose) {
    const key = action === 'copy' ? 'copied' : 'downloaded';
    const fallback = action === 'copy' ? 'Copied!' : 'Downloaded!';
    showInPlaceToast(chrome.i18n.getMessage(key) || fallback);
  }

  if (shouldClose) {
    await delay(400);
    window.close();
  }
}

const autoMatch = window.location.hash.match(AUTO_MARKER_RE);
if (autoMatch) {
  const action = autoMatch[1] === 'copy' ? 'copy' : 'download';
  autoExtract(action);
}

// ─── In-place toast ─────────────────────────────────────────────────

function showInPlaceToast(text: string): void {
  const t = document.createElement('div');
  t.textContent = text;
  t.style.cssText = [
    'position:fixed',
    'top:24px',
    'left:50%',
    'transform:translateX(-50%) translateY(-8px)',
    'background:rgba(15,20,25,0.92)',
    'color:#fff',
    'padding:10px 16px',
    'border-radius:9999px',
    'font:500 14px/1.2 system-ui,-apple-system,Segoe UI,sans-serif',
    'box-shadow:0 4px 16px rgba(0,0,0,0.25)',
    'z-index:2147483647',
    'pointer-events:none',
    'opacity:0',
    'transition:opacity 180ms ease,transform 180ms ease',
  ].join(';');
  document.body.appendChild(t);
  requestAnimationFrame(() => {
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(-8px)';
    setTimeout(() => t.remove(), 220);
  }, 2000);
}

// ─── In-place triggers (same-tab extraction) ────────────────────────
// Used when the user clicks the inline button or context menu while
// already on the tweet's permalink page — no point opening a new tab.

window.addEventListener('tweet2md:autoextract', (e: Event) => {
  const detail = (e as CustomEvent).detail as { action?: string } | undefined;
  const action = detail?.action === 'copy' ? 'copy' : 'download';
  autoExtract(action, { allowClose: false });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.action === 'TWEET2MD_AUTOEXTRACT') {
    const action = msg.subAction === 'copy' ? 'copy' : 'download';
    autoExtract(action, { allowClose: false }).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
