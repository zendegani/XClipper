import type {
  DownloadRequest,
  OffscreenRenderPdfResponse,
  PdfPrintRequest,
  PdfRenderRequest,
  PdfRenderResponse,
} from '../types/messages';
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

// ─── Offscreen PDF renderer ────────────────────────────────────────
//
// PDF generation runs in chrome-extension://<id>/offscreen.html (extension
// origin) so html2canvas's offscreen-iframe clone never touches X.com's
// <script src="…twimg.com…"> tags — those tags inside the page's
// documentElement otherwise re-execute in the clone and trip CSP, leaving
// the PDF blank. Content script delegates here.

const OFFSCREEN_PATH = 'offscreen.html';
const OFFSCREEN_RESPONSE_TIMEOUT_MS = 90_000;
let offscreenCreating: Promise<void> | null = null;

const bgLog = (...args: unknown[]): void => console.log('[t2m bg]', ...args);

async function ensureOffscreenDocument(): Promise<void> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    documentUrls: [url],
  });
  if (existing.length > 0) {
    bgLog('offscreen already alive');
    return;
  }
  if (offscreenCreating) {
    bgLog('offscreen create in-flight, awaiting…');
    await offscreenCreating;
    return;
  }
  bgLog('creating offscreen document…');
  offscreenCreating = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['DOM_SCRAPING' as chrome.offscreen.Reason],
      justification:
        'Render tweet HTML to a PDF via html2canvas in an extension-origin document, so the snapshot iframe is not bound by x.com page CSP.',
    })
    .then(() => {
      bgLog('offscreen.createDocument resolved');
    })
    .finally(() => {
      offscreenCreating = null;
    });
  await offscreenCreating;
  // createDocument resolves when the document is loaded, but a freshly-loaded
  // offscreen page may not have its top-level script's onMessage listener
  // bound by the time we send the next message. Wait for an explicit ping.
  await waitForOffscreenReady();
}

async function waitForOffscreenReady(): Promise<void> {
  const deadline = Date.now() + 5_000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const resp = (await chrome.runtime.sendMessage({ action: 'OFFSCREEN_PING' })) as
        | { pong?: boolean }
        | undefined;
      if (resp?.pong) {
        bgLog(`offscreen ready after ${attempt} ping(s)`);
        return;
      }
    } catch {
      /* listener may not be attached yet — retry */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Offscreen page failed to register listener within 5s');
}

function sendWithTimeout<T>(message: unknown, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    chrome.runtime.sendMessage(message).then(
      (resp) => {
        clearTimeout(t);
        resolve(resp as T);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}

async function downloadPdfDataUrl(dataUrl: string, filenameBase: string): Promise<void> {
  const folder = await loadDownloadFolder();
  const prefix = folder ? folder + '/' : '';
  const filename = sanitizeFilePath(prefix + filenameBase + '.pdf');
  await new Promise<void>((resolve, reject) => {
    chrome.downloads.download({ url: dataUrl, filename, saveAs: false }, (id) => {
      if (chrome.runtime.lastError || typeof id !== 'number') {
        reject(new Error(chrome.runtime.lastError?.message || 'Download failed'));
        return;
      }
      resolve();
    });
  });
}

// ─── Print spike: open print.html in a new tab and let Chrome render ───
//
// Content sends PDF_PRINT_REQUEST { html, filenameBase }. We stash the HTML
// in chrome.storage.session keyed by a uuid, then open a tab pointing at
// print.html?key=<uuid>. The print page picks the payload up, hydrates the
// DOM, calls window.print(), and self-closes on afterprint. The user picks
// "Save as PDF" in the dialog.

const PRINT_STORAGE_PREFIX = 't2m_print_';

function newPrintKey(): string {
  // crypto.randomUUID is available in MV3 service workers.
  return crypto.randomUUID();
}

chrome.runtime.onMessage.addListener((message: PdfPrintRequest, _sender, sendResponse) => {
  if (!message || message.action !== 'PDF_PRINT_REQUEST') return false;
  bgLog('PDF_PRINT_REQUEST received, html length =', message.html.length);
  (async (): Promise<PdfRenderResponse> => {
    try {
      const key = newPrintKey();
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

chrome.runtime.onMessage.addListener((message: PdfRenderRequest, _sender, sendResponse) => {
  if (!message || message.action !== 'PDF_RENDER_REQUEST') return false;
  bgLog('PDF_RENDER_REQUEST received, html length =', message.html.length);
  (async (): Promise<PdfRenderResponse> => {
    try {
      await ensureOffscreenDocument();
      bgLog('forwarding to offscreen…');
      const resp = await sendWithTimeout<OffscreenRenderPdfResponse | undefined>(
        {
          action: 'OFFSCREEN_RENDER_PDF',
          html: message.html,
        },
        OFFSCREEN_RESPONSE_TIMEOUT_MS,
        'OFFSCREEN_RENDER_PDF',
      );
      bgLog('offscreen response success:', resp?.success);
      if (!resp) return { success: false, error: 'Offscreen did not respond' };
      if (!resp.success || !resp.dataUrl) {
        return { success: false, error: resp.error || 'Offscreen returned no PDF' };
      }
      await downloadPdfDataUrl(resp.dataUrl, message.filenameBase);
      bgLog('PDF download triggered');
      return { success: true };
    } catch (err) {
      bgLog('PDF flow error:', err);
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
