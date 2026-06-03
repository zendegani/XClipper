import type { DownloadRequest, ExtractResponse } from '../types/messages';
import { postProcess, resolveDownloadImages, buildFilename } from '../shared/post-process';
import { buildObsidianUrl } from '../shared/obsidian';
import { delay, isArticlePage } from './dom';
import { extractArticle } from './article';
import { extractTweetAsync, extractEngagementMetadata } from './tweet';
import { waitForArticle } from './wait';
import { exportPdf } from './pdf-export';

type AutoAction = 'download' | 'copy' | 'obsidian';

// ─── Main Extraction Entry Point ────────────────────────────────────

export async function extract(options?: {
  includeMetadata?: boolean;
  singleTweet?: boolean;
}): Promise<ExtractResponse> {
  try {
    if (!window.location.pathname.includes('/status/')) {
      return {
        success: false,
        error: 'Not on an X.com status page. Navigate to a tweet or article first.',
      };
    }

    const isArticle = isArticlePage();
    const data = isArticle
      ? extractArticle()
      : await extractTweetAsync({ singleTweet: options?.singleTweet });

    if (options?.includeMetadata) {
      const firstArticle = document.querySelector('article[role="article"]');
      if (firstArticle) {
        data.metadata = extractEngagementMetadata(firstArticle);
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
      singleTweet: _message.singleTweet === true,
    }).then(sendResponse);
    return true;
  }
  if (_message.action === 'EXPORT_PDF') {
    runPdfExport().then(
      () => sendResponse({ success: true }),
      (err: unknown) => sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) }),
    );
    return true;
  }
  return true;
});

async function runPdfExport(): Promise<void> {
  await waitForArticle();
  const response = await extract({ includeMetadata: true });
  if (!response.success || !response.data || !response.data.body) {
    throw new Error(response.error || 'PDF export: extraction failed');
  }
  const filename = buildFilename(response.data).replace(/\.md$/i, '');
  await exportPdf(response.data.body, filename);
}

// ─── Auto-extract bootstrap (#tweet2md=download | #tweet2md=copy) ───
// Triggered when the page is opened from the inline button or context menu.

const AUTO_MARKER_RE = /[#&]tweet2md=(download|copy|obsidian|pdf|1)/;
const AUTO_SINGLE_MARKER_RE = /[#&]tweet2md_single=1/;
const AUTO_MARKER_STRIP_RE = /[#&]tweet2md(?:_single)?=(?:download|copy|obsidian|pdf|1)/g;

interface StoredSettings {
  downloadImages?: boolean;
  includeMetadata?: boolean;
  closeTabAfterExport?: boolean;
  inlineStats?: boolean;
  obsidianFriendly?: boolean;
  obsidianVault?: string;
  obsidianFolder?: string;
  filenameTemplate?: string;
  frontmatterFields?: Record<string, boolean>;
  frontmatterFieldsObsidian?: Record<string, boolean>;
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
  action: AutoAction,
  opts: { allowClose?: boolean; singleTweet?: boolean } = {}
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
  action: AutoAction,
  opts: { allowClose?: boolean; singleTweet?: boolean }
): Promise<void> {
  const allowClose = opts.allowClose !== false;
  const singleTweet = opts.singleTweet === true;

  // Strip the marker from the URL so refreshes don't re-trigger.
  try {
    const cleanHash = window.location.hash
      .replace(AUTO_MARKER_STRIP_RE, '')
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
  // Obsidian is the dedicated Obsidian path — force its schema + skip local
  // image downloads (the deeplink carries Markdown via URL, not a folder).
  const obsidianFriendly =
    action === 'obsidian' ? true : settings.obsidianFriendly === true;
  const downloadImages =
    action === 'obsidian' ? false : resolveDownloadImages(action, settings.downloadImages === true);
  const shouldClose = allowClose && settings.closeTabAfterExport === true;

  // Need engagement data if either renderer wants it.
  const response = await extract({
    includeMetadata: includeMetadata || inlineStats,
    singleTweet,
  });
  if (!response.success || !response.data) return;

  const frontmatterFields = obsidianFriendly
    ? settings.frontmatterFieldsObsidian
    : settings.frontmatterFields;

  const result = postProcess(response.data, {
    includeMetadata,
    downloadImages,
    inlineStats,
    obsidianFriendly,
    filenameTemplate: (settings.filenameTemplate || '').trim(),
    frontmatterFields,
  });

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
  } else if (action === 'obsidian') {
    const vault = (settings.obsidianVault || '').trim();
    const folder = (settings.obsidianFolder || '').trim();
    const url = buildObsidianUrl(result.markdown, result.filename, vault, folder);
    if (allowClose) {
      // New-tab flow: navigate the tab itself so the OS protocol handler
      // picks it up.
      window.location.href = url;
    } else {
      // In-place flow (already on the tweet's permalink): don't navigate the
      // user away from x.com. Pop a throwaway tab whose only job is to hand
      // the URL off to the OS, then show a confirmation toast.
      window.open(url, '_blank', 'noopener');
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
    const key =
      action === 'copy' ? 'copied'
      : action === 'obsidian' ? 'obsidian_opened'
      : 'downloaded';
    const fallback =
      action === 'copy' ? 'Copied!'
      : action === 'obsidian' ? 'Opening Obsidian…'
      : 'Downloaded!';
    showInPlaceToast(chrome.i18n.getMessage(key) || fallback);
  }

  // The Obsidian flow navigates the tab to an `obsidian://` URL, which triggers
  // an OS-level "Open Obsidian.app?" prompt that the user must confirm. Closing
  // the tab here would dismiss that prompt before they can answer it, so the
  // close-after-export toggle is intentionally skipped for this action.
  if (shouldClose && action !== 'obsidian') {
    await delay(400);
    window.close();
  }
}

const autoMatch = window.location.hash.match(AUTO_MARKER_RE);
if (autoMatch) {
  const raw = autoMatch[1];
  if (raw === 'pdf') {
    // PDF runs its own pipeline (AST → HTML → html2pdf) without the
    // markdown/postProcess flow that the other actions share.
    try {
      const cleanHash = window.location.hash
        .replace(AUTO_MARKER_STRIP_RE, '')
        .replace(/^#$/, '');
      history.replaceState(null, '', window.location.pathname + window.location.search + (cleanHash || ''));
    } catch { /* history may be unavailable */ }
    runPdfExport().catch((err) => console.error('tweet2md PDF export failed:', err));
  } else {
    const action: AutoAction =
      raw === 'copy' ? 'copy' : raw === 'obsidian' ? 'obsidian' : 'download';
    const singleTweet = AUTO_SINGLE_MARKER_RE.test(window.location.hash);
    autoExtract(action, { singleTweet });
  }
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

function coerceAutoAction(raw: unknown): AutoAction {
  return raw === 'copy' ? 'copy' : raw === 'obsidian' ? 'obsidian' : 'download';
}

window.addEventListener('tweet2md:autoextract', (e: Event) => {
  const detail = (e as CustomEvent).detail as
    | { action?: string; single?: boolean }
    | undefined;
  autoExtract(coerceAutoAction(detail?.action), {
    allowClose: false,
    singleTweet: detail?.single === true,
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.action === 'TWEET2MD_AUTOEXTRACT') {
    autoExtract(coerceAutoAction(msg.subAction), {
      allowClose: false,
      singleTweet: msg.single === true,
    }).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
