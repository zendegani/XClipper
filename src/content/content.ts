import type { DownloadRequest, ExtractResponse } from '../types/messages';
import { postProcess, resolveDownloadImages } from '../shared/post-process';
import { delay, isArticlePage } from './dom';
import { extractArticle } from './article';
import { extractTweetAsync, extractEngagementMetadata } from './tweet';
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
}

function loadStoredSettings(): Promise<StoredSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get('tweet2md_settings', (result) => {
      resolve((result['tweet2md_settings'] as StoredSettings) || {});
    });
  });
}

async function autoExtract(action: 'download' | 'copy'): Promise<void> {
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
  const downloadImages = resolveDownloadImages(action, settings.downloadImages === true);
  const shouldClose = settings.closeTabAfterExport === true; // default off

  const response = await extract({ includeMetadata });
  if (!response.success || !response.data) return;

  const result = postProcess(response.data, { includeMetadata, downloadImages });

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
