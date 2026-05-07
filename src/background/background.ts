import type { DownloadRequest } from '../types/messages';

// ─── Context menu: Save / Copy tweet as Markdown ────────────────────

const MENU_SAVE = 'tweet2md-save';
const MENU_COPY = 'tweet2md-copy';
const STATUS_URL_PATTERN = /^https?:\/\/(?:www\.)?x\.com\/[^/]+\/status\/\d+/;

// Strip any path beyond /status/<id> (e.g. /history, /photo/1, /analytics) and
// drop any existing query/hash, so we always open the canonical permalink.
function normalizeStatusUrl(url: string): string | null {
  const m = url.match(/^(https?:\/\/(?:www\.)?x\.com\/[^/]+\/status\/\d+)/);
  return m ? m[1] : null;
}

// Last known tweet URL under the user's cursor, set by the injector content
// script on `contextmenu`. Used when info.linkUrl is missing (right-click on
// tweet body or media instead of the timestamp link).
let lastContextUrl: string | null = null;

function registerContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_SAVE,
      title: chrome.i18n.getMessage('ctx_save_tweet') || 'Save tweet as Markdown',
      contexts: ['link', 'page'],
      targetUrlPatterns: ['*://x.com/*/status/*'],
      documentUrlPatterns: ['*://x.com/*'],
    });
    chrome.contextMenus.create({
      id: MENU_COPY,
      title: chrome.i18n.getMessage('ctx_copy_tweet') || 'Copy tweet as Markdown',
      contexts: ['link', 'page'],
      targetUrlPatterns: ['*://x.com/*/status/*'],
      documentUrlPatterns: ['*://x.com/*'],
    });
  });
}

chrome.runtime.onInstalled.addListener(registerContextMenus);
chrome.runtime.onStartup.addListener(registerContextMenus);

function appendMarker(url: string, action: 'download' | 'copy'): string {
  // Strip any existing tweet2md marker so we don't compound them.
  const cleaned = url.replace(/[#&]tweet2md=(?:download|copy|1)/g, '').replace(/#$/, '');
  const sep = cleaned.includes('#') ? '&' : '#';
  return cleaned + sep + 'tweet2md=' + action;
}

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_SAVE && info.menuItemId !== MENU_COPY) return;

  // Prefer an explicit link the user right-clicked on, then the URL the
  // injector reported for the tweet under the cursor, then the page URL.
  // Normalize each candidate to /status/<id> — the link may be a sub-path
  // like /history or /photo/1 which would otherwise break extraction.
  const target =
    (info.linkUrl && normalizeStatusUrl(info.linkUrl)) ||
    (lastContextUrl && normalizeStatusUrl(lastContextUrl)) ||
    (info.pageUrl && normalizeStatusUrl(info.pageUrl)) ||
    '';
  if (!target) return;

  const action = info.menuItemId === MENU_COPY ? 'copy' : 'download';
  chrome.tabs.create({ url: appendMarker(target, action) });
});

chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (msg && msg.action === 'TWEET2MD_CTX_URL') {
    lastContextUrl = typeof msg.url === 'string' ? msg.url : null;
  }
  return false;
});

// ─── Download handler ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: DownloadRequest, _sender, sendResponse) => {
    if (message.action !== 'DOWNLOAD_MD') return false;

    // First download any required images
    if (message.images && message.images.length > 0) {
      for (const img of message.images) {
        chrome.downloads.download({
          url: img.url,
          filename: sanitizeFilePath(img.filename),
          saveAs: false,
        });
      }
    }

    const dataUrl =
      'data:text/markdown;charset=utf-8,' +
      encodeURIComponent(message.content);

    chrome.downloads.download(
      {
        url: dataUrl,
        filename: sanitizeFilePath(message.filename),
        saveAs: false,
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message,
          });
        } else {
          sendResponse({ success: true, downloadId });
        }
      }
    );

    return true; // keep channel open for async sendResponse
  }
);

/**
 * Remove characters that are invalid in filenames/paths.
 * Allows '/' to organize images into a folder next to markdown.
 */
function sanitizeFilePath(name: string): string {
  return name
    .replace(/[<>:"\\|?*\x00-\x1f]/g, '_') // removed '/' from invalid chars
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    // don't drop leading/trailing slash handling because we want folder structure
    .slice(0, 200); // Keep path length reasonable
}
