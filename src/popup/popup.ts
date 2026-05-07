import type { ExtractResponse, DownloadRequest } from '../types/messages';
import { postProcess, type PostProcessResult } from '../shared/post-process';

const btnDownload = document.getElementById('btn-download') as HTMLButtonElement;
const btnCopy = document.getElementById('btn-copy') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const chkDownloadImages = document.getElementById(
  'chk-download-images'
) as HTMLInputElement;
const chkMetadata = document.getElementById(
  'chk-include-metadata'
) as HTMLInputElement;
const chkCloseTab = document.getElementById(
  'chk-close-tab'
) as HTMLInputElement;
const chkInlineCopies = document.getElementById(
  'chk-inline-copies'
) as HTMLInputElement;

// ─── Initialize i18n ──────────────────────────────────────────────────

document.querySelectorAll('[data-i18n]').forEach((el) => {
  const key = el.getAttribute('data-i18n');
  if (key) {
    el.textContent = chrome.i18n.getMessage(key) || el.textContent;
  }
});
document.querySelectorAll('[data-i18n-title]').forEach((el) => {
  const key = el.getAttribute('data-i18n-title');
  if (key) {
    el.setAttribute('title', chrome.i18n.getMessage(key) || el.getAttribute('title')!);
  }
});

// ─── Settings Persistence ───────────────────────────────────────────

const SETTINGS_KEY = 'tweet2md_settings';

interface Settings {
  downloadImages: boolean;
  includeMetadata: boolean;
  closeTabAfterExport: boolean;
  inlineButtonCopies: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  downloadImages: false,
  includeMetadata: true, // on by default
  closeTabAfterExport: false,
  inlineButtonCopies: false, // inline button downloads by default
};

async function loadSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(SETTINGS_KEY, (result) => {
      const saved = result[SETTINGS_KEY] as Partial<Settings> | undefined;
      resolve({ ...DEFAULT_SETTINGS, ...saved });
    });
  });
}

function saveSettings(settings: Settings): void {
  chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

// Restore toggle states on popup open
loadSettings().then((settings) => {
  chkDownloadImages.checked = settings.downloadImages;
  chkMetadata.checked = settings.includeMetadata;
  chkCloseTab.checked = settings.closeTabAfterExport;
  chkInlineCopies.checked = settings.inlineButtonCopies;
});

function persistAll(): void {
  saveSettings({
    downloadImages: chkDownloadImages.checked,
    includeMetadata: chkMetadata.checked,
    closeTabAfterExport: chkCloseTab.checked,
    inlineButtonCopies: chkInlineCopies.checked,
  });
}

chkDownloadImages.addEventListener('change', persistAll);
chkMetadata.addEventListener('change', persistAll);
chkCloseTab.addEventListener('change', persistAll);
chkInlineCopies.addEventListener('change', persistAll);

// ─── Helpers ────────────────────────────────────────────────────────

function showStatus(
  message: string,
  type: 'success' | 'error' | 'info'
): void {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;

  // Auto-hide success messages after 3 seconds
  if (type === 'success') {
    setTimeout(() => {
      statusEl.className = 'status hidden';
    }, 3000);
  }
}

function setLoading(loading: boolean, target?: 'download' | 'copy'): void {
  btnDownload.disabled = loading;
  btnCopy.disabled = loading;

  // Only animate the button that was actually clicked
  if (target === 'download' || !target) {
    btnDownload.classList.toggle('loading', loading);
    const dlLabel = btnDownload.querySelector('.btn-label');
    if (dlLabel) dlLabel.textContent = loading ? (chrome.i18n.getMessage('extracting') || 'Extracting…') : (chrome.i18n.getMessage('btn_download') || 'Download .md');
  }
  if (target === 'copy' || !target) {
    btnCopy.classList.toggle('loading', loading);
    const cpLabel = btnCopy.querySelector('.btn-label');
    if (cpLabel) cpLabel.textContent = loading ? (chrome.i18n.getMessage('extracting') || 'Extracting…') : (chrome.i18n.getMessage('btn_copy') || 'Copy .md');
  }

  // When stopping, always reset both to default state
  if (!loading) {
    btnDownload.classList.remove('loading');
    btnCopy.classList.remove('loading');
    const dlLabel = btnDownload.querySelector('.btn-label');
    const cpLabel = btnCopy.querySelector('.btn-label');
    if (dlLabel) dlLabel.textContent = chrome.i18n.getMessage('btn_download') || 'Download .md';
    if (cpLabel) cpLabel.textContent = chrome.i18n.getMessage('btn_copy') || 'Copy .md';
  }
}

// ─── Shared Extraction ──────────────────────────────────────────────

async function extractMarkdown(): Promise<PostProcessResult> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.id) {
    throw new Error('Unable to access the current tab.');
  }

  const url = tab.url || '';
  if (!url.includes('x.com/')) {
    throw new Error(chrome.i18n.getMessage('footer_hint') || 'Navigate to a tweet or article on X.com first.');
  }

  if (!url.includes('/status/')) {
    throw new Error(
      chrome.i18n.getMessage('error_specific_page') || 'Open a specific tweet or article page (with /status/ in the URL).'
    );
  }

  const includeMetadata = chkMetadata.checked;
  const downloadImages = chkDownloadImages.checked;

  const response: ExtractResponse = await chrome.tabs.sendMessage(tab.id, {
    action: 'EXTRACT',
    includeMetadata,
  });

  if (!response.success || !response.data) {
    throw new Error(response.error || chrome.i18n.getMessage('error_failed') || 'Failed to extract content.');
  }

  return postProcess(response.data, { includeMetadata, downloadImages });
}

function handleExtractionError(err: unknown): void {
  const message =
    err instanceof Error ? err.message : (chrome.i18n.getMessage('error_unexpected') || 'An unexpected error occurred.');

  if (message.includes('Receiving end does not exist')) {
    showStatus(chrome.i18n.getMessage('error_reload') || 'Reload the page and try again.', 'error');
  } else {
    showStatus(message, 'error');
  }
  setLoading(false);
}

// ─── Download Flow ──────────────────────────────────────────────────

btnDownload.addEventListener('click', async () => {
  setLoading(true, 'download');
  statusEl.className = 'status hidden';

  try {
    const result = await extractMarkdown();

    const downloadMsg: DownloadRequest = {
      action: 'DOWNLOAD_MD',
      content: result.markdown,
      filename: result.filename,
      images: result.images.length > 0 ? result.images : undefined,
    };

    chrome.runtime.sendMessage(downloadMsg, (downloadResponse) => {
      if (chrome.runtime.lastError || !downloadResponse?.success) {
        showStatus(downloadResponse?.error || chrome.i18n.getMessage('download_failed') || 'Download failed.', 'error');
      } else {
        const typeLabels: Record<string, string> = {
          article: chrome.i18n.getMessage('article_downloaded') || 'Article downloaded!',
          thread: chrome.i18n.getMessage('thread_downloaded') || 'Thread downloaded!',
          tweet: chrome.i18n.getMessage('tweet_downloaded') || 'Tweet downloaded!',
        };
        const label = typeLabels[result.type] || chrome.i18n.getMessage('downloaded') || 'Downloaded!';
        showStatus(`✓ ${label}`, 'success');
      }
      setLoading(false);
    });
  } catch (err) {
    handleExtractionError(err);
  }
});

// ─── Copy Flow ──────────────────────────────────────────────────────

btnCopy.addEventListener('click', async () => {
  setLoading(true, 'copy');
  statusEl.className = 'status hidden';

  try {
    const result = await extractMarkdown();

    await navigator.clipboard.writeText(result.markdown);

    const typeLabels: Record<string, string> = {
      article: chrome.i18n.getMessage('article_copied') || 'Article copied!',
      thread: chrome.i18n.getMessage('thread_copied') || 'Thread copied!',
      tweet: chrome.i18n.getMessage('tweet_copied') || 'Tweet copied!',
    };
    const label = typeLabels[result.type] || chrome.i18n.getMessage('copied') || 'Copied!';
    showStatus(`✓ ${label}`, 'success');
    setLoading(false);
  } catch (err) {
    handleExtractionError(err);
  }
});
