import type { BatchItemResultMessage, DownloadRequest, ExtractResponse } from '../types/messages';
import { postProcess, resolveDownloadImages, buildFilename } from '../shared/post-process';
import { loadSettings } from '../shared/settings';
import { buildObsidianUrl } from '../shared/obsidian';
import { recordExport } from '../shared/review-prompt';
import { delay, isArticlePage } from './dom';
import { extractArticle } from './article';
import { extractTweetAsync } from './tweet';
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
  const settings = await loadSettings();
  const includeEngagement = settings.inlineStats;
  const response = await extract({ includeMetadata: includeEngagement });
  if (!response.success || !response.data || !response.data.body) {
    throw new Error(response.error || 'PDF export: extraction failed');
  }
  const filename = buildFilename(response.data).replace(/\.md$/i, '');
  await exportPdf(response.data.body, filename, { includeEngagement });
}

// ─── Auto-extract bootstrap (#xclipper=download | #xclipper=copy) ───
// Triggered when the page is opened from the inline button or context menu.

const AUTO_MARKER_RE = /[#&]xclipper=(download|copy|obsidian|pdf|1)/;
const AUTO_SINGLE_MARKER_RE = /[#&]xclipper_single=1/;
const AUTO_MARKER_STRIP_RE = /[#&]xclipper(?:_single)?=(?:download|copy|obsidian|pdf|1)/g;

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

  const settings = await loadSettings();
  const includeMetadata = settings.includeMetadata;
  const inlineStats = settings.inlineStats;
  // Obsidian is the dedicated Obsidian path — force its schema + skip local
  // image downloads (the deeplink carries Markdown via URL, not a folder).
  const obsidianFriendly =
    action === 'obsidian' ? true : settings.obsidianFriendly;
  const downloadImages =
    action === 'obsidian' ? false : resolveDownloadImages(action, settings.downloadImages);
  const shouldClose = allowClose && settings.closeTabAfterExport;

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
    filenameTemplate: settings.filenameTemplate.trim(),
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
    const vault = settings.obsidianVault.trim();
    const folder = settings.obsidianFolder.trim();
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
    void recordExport();
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
    void recordExport();
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
    runPdfExport().then(() => void recordExport()).catch((err) => console.error('XClipper PDF export failed:', err));
  } else {
    const action: AutoAction =
      raw === 'copy' ? 'copy' : raw === 'obsidian' ? 'obsidian' : 'download';
    const singleTweet = AUTO_SINGLE_MARKER_RE.test(window.location.hash);
    autoExtract(action, { singleTweet });
  }
}

// ─── Batch extraction (#xclipper=batch) ─────────────────────────────
// The hidden worker tab opened by the background batch orchestrator
// (ADR 0002) lands here. Extract with the user's saved settings, finalize the
// markdown locally, and report back — the background owns the queue, the
// throttle, and the folder sink. Errors are reported too, so the orchestrator
// can skip-and-record instead of waiting for its timeout.

const BATCH_MARKER_RE = /[#&]xclipper=batch/;

// X serves a login or rate-limit wall (not the tweet) when the session expires
// or a batch has been navigating permalinks too fast. These are session-level
// problems, not per-item ones, so the orchestrator pauses the whole job (ADR
// 0002 #7) rather than recording a failure and pressing on. Only consulted when
// no <article> rendered — a deleted/withheld tweet ("unavailable"/"doesn't
// exist") also has no article but uses different copy, so it stays a per-item
// skip and returns null here.
function detectBatchInterstitial(): string | null {
  if (/^\/(i\/flow\/login|login|account\/access)/.test(window.location.pathname)) {
    return 'Signed out of X';
  }
  if (document.querySelector('input[autocomplete="username"], input[name="text"][autocapitalize="none"]')) {
    return 'X is asking you to sign in';
  }
  const text = (document.querySelector('#react-root')?.textContent || '').toLowerCase();
  if (text.includes('rate limit') || text.includes('try reloading')) {
    return 'X is rate-limiting';
  }
  return null;
}

async function runBatchExtract(): Promise<void> {
  let msg: BatchItemResultMessage;
  try {
    const article = await waitForArticle();
    if (!article) {
      const interstitial = detectBatchInterstitial();
      if (interstitial) {
        msg = {
          action: 'BATCH_ITEM_RESULT',
          url: window.location.href,
          success: false,
          interstitial,
        };
        chrome.runtime.sendMessage(msg);
        return;
      }
      throw new Error('Timed out waiting for tweet content');
    }

    const settings = await loadSettings();
    const response = await extract({
      includeMetadata: settings.includeMetadata || settings.inlineStats,
    });
    if (!response.success || !response.data) {
      throw new Error(response.error || 'Extraction failed');
    }
    // Same option resolution as the auto-extract 'download' flow above.
    const frontmatterFields = settings.obsidianFriendly
      ? settings.frontmatterFieldsObsidian
      : settings.frontmatterFields;
    const result = postProcess(response.data, {
      includeMetadata: settings.includeMetadata,
      downloadImages: resolveDownloadImages('download', settings.downloadImages),
      inlineStats: settings.inlineStats,
      obsidianFriendly: settings.obsidianFriendly,
      filenameTemplate: settings.filenameTemplate.trim(),
      frontmatterFields,
    });
    msg = {
      action: 'BATCH_ITEM_RESULT',
      url: window.location.href,
      success: true,
      markdown: result.markdown,
      filename: result.filename,
      images: result.images.length > 0 ? result.images : undefined,
      doc: response.data.body,
    };
  } catch (err) {
    msg = {
      action: 'BATCH_ITEM_RESULT',
      url: window.location.href,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  // Stop loading below-the-fold recommendations/ads while the orchestrator's
  // throttle runs (ADR 0002 #9). Only safe *after* extraction — stopping
  // earlier can abort the fetches that hydrate the rest of a thread.
  try {
    window.stop();
  } catch {
    // ignore
  }
  chrome.runtime.sendMessage(msg);
}

if (BATCH_MARKER_RE.test(window.location.hash)) {
  runBatchExtract();
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

window.addEventListener('xclipper:autoextract', (e: Event) => {
  const detail = (e as CustomEvent).detail as
    | { action?: string; single?: boolean }
    | undefined;
  autoExtract(coerceAutoAction(detail?.action), {
    allowClose: false,
    singleTweet: detail?.single === true,
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.action === 'XCLIPPER_AUTOEXTRACT') {
    if (msg.subAction === 'pdf') {
      // PDF uses its own AST → HTML → print pipeline, not the markdown flow.
      runPdfExport()
        .then(() => sendResponse({ ok: true }))
        .catch((err: unknown) =>
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
    } else {
      autoExtract(coerceAutoAction(msg.subAction), {
        allowClose: false,
        singleTweet: msg.single === true,
      }).then(() => sendResponse({ ok: true }));
    }
    return true;
  }
  return false;
});
