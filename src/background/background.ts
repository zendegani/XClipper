import type {
  AutoExtractRequest,
  DownloadRequest,
  PdfPrintRequest,
  PdfPrintResponse,
} from '../types/messages';
import {
  isAllowedImageUrl,
  isTrustedDownloadSender,
  isTrustedXContentSender,
  sanitizeFilePath,
} from './security';
import { initBatch } from './batch';
import { normalizeStatusUrl } from './batch-state';

// ─── Context menu: Save / Copy tweet as Markdown ────────────────────

const MENU_PARENT = 'xclipper-root';
const MENU_SAVE = 'xclipper-save';
const MENU_COPY = 'xclipper-copy';
const MENU_COPY_SINGLE = 'xclipper-copy-single';
const MENU_OBSIDIAN = 'xclipper-obsidian';
const MENU_PDF = 'xclipper-pdf';

type MenuAction = 'download' | 'copy' | 'obsidian' | 'pdf';

// Last known tweet URL under the user's cursor, set by the injector content
// script on `contextmenu`. Used when info.linkUrl is missing (right-click on
// tweet body or media instead of the timestamp link).
let lastContextUrl: string | null = null;

function registerContextMenus(): void {
  // Explicit parent suppresses Chrome's auto-group label (which would use
  // the full extension name).
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_PARENT,
      title: 'XClipper',
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

// Batch export orchestrator (ADR 0002) — registers its own listeners.
initBatch();

// One-time migration: project renamed tweet2md → XClipper in v2.0.0. Existing
// users have preferences stored under the old `tweet2md_settings` key. Copy
// into the new `xclipper_settings` key. Runs at SW startup (not just
// onInstalled) so we win the race against any popup/content script that might
// create an empty xclipper_settings before the install event fires. The guard
// makes it idempotent — once xclipper_settings exists, subsequent runs skip.
// Remove this block on or after 2026-07-05 — anyone who hasn't opened the
// extension for a month is a light user with minimal settings to lose.
function migrateTweet2mdSettings(): void {
  chrome.storage.local.get(['tweet2md_settings', 'xclipper_settings'], (result) => {
    if (!result.xclipper_settings && result.tweet2md_settings) {
      chrome.storage.local.set({ xclipper_settings: result.tweet2md_settings });
    }
  });
}
migrateTweet2mdSettings();
chrome.runtime.onInstalled.addListener(migrateTweet2mdSettings);

function appendMarker(url: string, action: MenuAction, single: boolean): string {
  // Strip any existing xclipper marker so we don't compound them.
  const cleaned = url
    .replace(/[#&]xclipper(?:_single)?=(?:download|copy|obsidian|pdf|1)/g, '')
    .replace(/#$/, '');
  const sep = cleaned.includes('#') ? '&' : '#';
  const singleSuffix = single ? '&xclipper_single=1' : '';
  return cleaned + sep + 'xclipper=' + action + singleSuffix;
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
    const autoExtract: AutoExtractRequest = {
      action: 'XCLIPPER_AUTOEXTRACT',
      subAction: action,
      single,
    };
    chrome.tabs.sendMessage(tab.id, autoExtract);
    return;
  }

  chrome.tabs.create({ url: appendMarker(target, action, single) });
});

chrome.runtime.onMessage.addListener((msg, sender, _sendResponse) => {
  if (!msg || msg.action !== 'XCLIPPER_CTX_URL') return false;
  if (!isTrustedXContentSender(sender)) return false;

  lastContextUrl = typeof msg.url === 'string' ? msg.url : null;
  return false;
});

// ─── Download handler ───────────────────────────────────────────────

const SETTINGS_KEY = 'xclipper_settings';

function loadDownloadFolder(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get(SETTINGS_KEY, (result) => {
      const settings = result[SETTINGS_KEY] as { downloadFolder?: unknown } | undefined;
      const folder = settings && typeof settings.downloadFolder === 'string' ? settings.downloadFolder : '';
      resolve(folder);
    });
  });
}

// ─── PDF via Chrome's print engine ─────────────────────────────────
//
// Content sends PDF_PRINT_REQUEST { html, filenameBase }. We stash the HTML
// in chrome.storage.session keyed by a uuid, then open a tab pointing at
// print.html?key=<uuid>. The print page picks the payload up, hydrates the
// DOM, calls window.print(), and self-closes on afterprint. The user picks
// "Save as PDF" in the print dialog — Chrome's native print engine
// produces selectable text, clickable links, real Unicode, and proper
// pagination for free. See ADR 0001 → "Renderer decisions".

const PRINT_STORAGE_PREFIX = 'xclipper_print_';

const bgLog = (...args: unknown[]): void => console.log('[xclipper bg]', ...args);

chrome.runtime.onMessage.addListener((message: PdfPrintRequest, _sender, sendResponse) => {
  if (!message || message.action !== 'PDF_PRINT_REQUEST') return false;
  bgLog('PDF_PRINT_REQUEST received, html length =', message.html.length);
  (async (): Promise<PdfPrintResponse> => {
    try {
      // crypto.randomUUID is available in MV3 service workers.
      const key = crypto.randomUUID();
      const storageKey = PRINT_STORAGE_PREFIX + key;
      await chrome.storage.session.set({
        [storageKey]: { html: message.html, filenameBase: message.filenameBase },
      });
      const url = chrome.runtime.getURL(`print.html?key=${encodeURIComponent(key)}`);
      await chrome.tabs.create({ url, active: true });
      bgLog('print tab opened:', url);
      return { success: true };
    } catch (err) {
      bgLog('print flow error:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  })().then(sendResponse);
  return true; // async
});

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
