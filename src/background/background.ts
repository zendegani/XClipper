import type { DownloadRequest } from '../types/messages';
import {
  isAllowedImageUrl,
  isTrustedDownloadSender,
  isTrustedXContentSender,
  sanitizeFilePath,
} from './security';

// ─── Context menu: Save / Copy tweet as Markdown ────────────────────

const MENU_PARENT = 'tweet2md-root';
const MENU_SAVE = 'tweet2md-save';
const MENU_COPY = 'tweet2md-copy';
const MENU_COPY_SINGLE = 'tweet2md-copy-single';
const MENU_OBSIDIAN = 'tweet2md-obsidian';
const MENU_PDF = 'tweet2md-pdf';

type MenuAction = 'download' | 'copy' | 'obsidian' | 'pdf';

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
  // Explicit parent suppresses Chrome's auto-group label (which would use
  // the full extension name "tweet2md: X Threads Articles to Markdown").
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_PARENT,
      title: 'tweet2md',
      contexts: ['link', 'page'],
      targetUrlPatterns: ['*://x.com/*/status/*'],
      documentUrlPatterns: ['*://x.com/*'],
    });
    chrome.contextMenus.create({
      id: MENU_SAVE,
      parentId: MENU_PARENT,
      title: chrome.i18n.getMessage('ctx_save_tweet') || 'Save tweet as Markdown',
      contexts: ['link', 'page'],
      targetUrlPatterns: ['*://x.com/*/status/*'],
      documentUrlPatterns: ['*://x.com/*'],
    });
    chrome.contextMenus.create({
      id: MENU_COPY,
      parentId: MENU_PARENT,
      title: chrome.i18n.getMessage('ctx_copy_tweet') || 'Copy tweet as Markdown',
      contexts: ['link', 'page'],
      targetUrlPatterns: ['*://x.com/*/status/*'],
      documentUrlPatterns: ['*://x.com/*'],
    });
    chrome.contextMenus.create({
      id: MENU_COPY_SINGLE,
      parentId: MENU_PARENT,
      title:
        chrome.i18n.getMessage('ctx_copy_just_this_tweet') ||
        'Copy just this tweet (no thread)',
      contexts: ['link', 'page'],
      targetUrlPatterns: ['*://x.com/*/status/*'],
      documentUrlPatterns: ['*://x.com/*'],
    });
    chrome.contextMenus.create({
      id: MENU_OBSIDIAN,
      parentId: MENU_PARENT,
      title: chrome.i18n.getMessage('ctx_obsidian_tweet') || 'Add tweet to Obsidian',
      contexts: ['link', 'page'],
      targetUrlPatterns: ['*://x.com/*/status/*'],
      documentUrlPatterns: ['*://x.com/*'],
    });
    chrome.contextMenus.create({
      id: MENU_PDF,
      parentId: MENU_PARENT,
      title: chrome.i18n.getMessage('ctx_save_tweet_pdf') || 'Save tweet as PDF',
      contexts: ['link', 'page'],
      targetUrlPatterns: ['*://x.com/*/status/*'],
      documentUrlPatterns: ['*://x.com/*'],
    });
  });
}

chrome.runtime.onInstalled.addListener(registerContextMenus);
chrome.runtime.onStartup.addListener(registerContextMenus);

function appendMarker(url: string, action: MenuAction, single: boolean): string {
  // Strip any existing tweet2md marker so we don't compound them.
  const cleaned = url
    .replace(/[#&]tweet2md(?:_single)?=(?:download|copy|obsidian|pdf|1)/g, '')
    .replace(/#$/, '');
  const sep = cleaned.includes('#') ? '&' : '#';
  const singleSuffix = single ? '&tweet2md_single=1' : '';
  return cleaned + sep + 'tweet2md=' + action + singleSuffix;
}

function menuItemAction(
  menuItemId: unknown
): { action: MenuAction; single: boolean } | null {
  if (menuItemId === MENU_SAVE) return { action: 'download', single: false };
  if (menuItemId === MENU_COPY) return { action: 'copy', single: false };
  if (menuItemId === MENU_COPY_SINGLE) return { action: 'copy', single: true };
  if (menuItemId === MENU_OBSIDIAN) return { action: 'obsidian', single: false };
  if (menuItemId === MENU_PDF) return { action: 'pdf', single: false };
  return null;
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const picked = menuItemAction(info.menuItemId);
  if (!picked) return;
  const { action, single } = picked;

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

  const pageNormalized = info.pageUrl ? normalizeStatusUrl(info.pageUrl) : null;

  // If the target tweet IS the current page, extract in place. Right-clicking
  // a reply's timestamp on a permalink page still opens a new tab because the
  // link URL points to a different status id than the page URL.
  if (pageNormalized && pageNormalized === target && tab?.id !== undefined) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'TWEET2MD_AUTOEXTRACT',
      subAction: action,
      single,
    });
    return;
  }

  chrome.tabs.create({ url: appendMarker(target, action, single) });
});

chrome.runtime.onMessage.addListener((msg, sender, _sendResponse) => {
  if (!msg || msg.action !== 'TWEET2MD_CTX_URL') return false;
  if (!isTrustedXContentSender(sender)) return false;

  lastContextUrl = typeof msg.url === 'string' ? msg.url : null;
  return false;
});

// ─── Download handler ───────────────────────────────────────────────

const SETTINGS_KEY = 'tweet2md_settings';

function loadDownloadFolder(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get(SETTINGS_KEY, (result) => {
      const settings = result[SETTINGS_KEY] as { downloadFolder?: unknown } | undefined;
      const folder = settings && typeof settings.downloadFolder === 'string' ? settings.downloadFolder : '';
      resolve(folder);
    });
  });
}

chrome.runtime.onMessage.addListener(
  (message: DownloadRequest, sender, sendResponse) => {
    if (!message || message.action !== 'DOWNLOAD_MD') return false;

    if (!isTrustedDownloadSender(sender, chrome.runtime.id)) {
      sendResponse({ success: false, error: 'Untrusted sender' });
      return false;
    }

    // Prepend the user-configured subfolder before sanitization so the
    // existing `..` / leading-slash / illegal-char stripping in
    // `sanitizeFilePath` applies to the combined path too.
    loadDownloadFolder().then((folder) => {
      const prefix = folder ? folder + '/' : '';

      // First download any required images
      if (message.images && message.images.length > 0) {
        for (const img of message.images) {
          if (!img || typeof img.url !== 'string' || !isAllowedImageUrl(img.url)) {
            continue;
          }

          chrome.downloads.download({
            url: img.url,
            filename: sanitizeFilePath(prefix + img.filename),
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
          filename: sanitizeFilePath(prefix + message.filename),
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
    });

    return true; // keep channel open for async sendResponse
  }
);
