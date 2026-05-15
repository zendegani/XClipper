import type { ExtractResponse, DownloadRequest } from '../types/messages';
import { postProcess, resolveDownloadImages, type PostProcessResult } from '../shared/post-process';

const btnDownload = document.getElementById('btn-download') as HTMLButtonElement;
const btnCopy = document.getElementById('btn-copy') as HTMLButtonElement;
const btnObsidian = document.getElementById('btn-obsidian') as HTMLButtonElement;
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
const chkShowInline = document.getElementById(
  'chk-show-inline'
) as HTMLInputElement;
const chkInlineStats = document.getElementById(
  'chk-inline-stats'
) as HTMLInputElement;
const chkObsidianFriendly = document.getElementById(
  'chk-obsidian-friendly'
) as HTMLInputElement;
const txtObsidianVault = document.getElementById(
  'txt-obsidian-vault'
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
document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
  const key = el.getAttribute('data-i18n-placeholder');
  if (key) {
    const msg = chrome.i18n.getMessage(key);
    if (msg) el.setAttribute('placeholder', msg);
  }
});

// ─── View switching: main ↔ settings ──────────────────────────────────

const viewMain = document.getElementById('view-main');
const viewSettings = document.getElementById('view-settings');
const btnSettings = document.getElementById('btn-settings');
const btnBack = document.getElementById('btn-back');

btnSettings?.addEventListener('click', () => {
  viewMain?.classList.add('hidden');
  viewSettings?.classList.remove('hidden');
});
btnBack?.addEventListener('click', () => {
  viewSettings?.classList.add('hidden');
  viewMain?.classList.remove('hidden');
});

// ─── Settings Persistence ───────────────────────────────────────────

const SETTINGS_KEY = 'tweet2md_settings';

interface Settings {
  downloadImages: boolean;
  includeMetadata: boolean;
  closeTabAfterExport: boolean;
  inlineButtonCopies: boolean;
  showInlineButton: boolean;
  inlineStats: boolean;
  obsidianFriendly: boolean;
  obsidianVault: string;
}

const DEFAULT_SETTINGS: Settings = {
  downloadImages: false,
  includeMetadata: true, // on by default
  closeTabAfterExport: false,
  inlineButtonCopies: false, // inline button downloads by default
  showInlineButton: true, // inline button visible by default
  inlineStats: false, // off — changes visible content, opt-in
  obsidianFriendly: false, // off — changes frontmatter shape, opt-in
  obsidianVault: '', // empty → let Obsidian pick the last-used vault
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

function updateInlineCopiesEnabled(): void {
  const enabled = chkShowInline.checked;
  chkInlineCopies.disabled = !enabled;
  chkInlineCopies.closest('.toggle-label')?.classList.toggle('disabled', !enabled);
}

// Restore toggle states on popup open
loadSettings().then((settings) => {
  chkDownloadImages.checked = settings.downloadImages;
  chkMetadata.checked = settings.includeMetadata;
  chkCloseTab.checked = settings.closeTabAfterExport;
  chkInlineCopies.checked = settings.inlineButtonCopies;
  chkShowInline.checked = settings.showInlineButton;
  chkInlineStats.checked = settings.inlineStats;
  chkObsidianFriendly.checked = settings.obsidianFriendly;
  txtObsidianVault.value = settings.obsidianVault;
  updateInlineCopiesEnabled();
});

function persistAll(): void {
  saveSettings({
    downloadImages: chkDownloadImages.checked,
    includeMetadata: chkMetadata.checked,
    closeTabAfterExport: chkCloseTab.checked,
    inlineButtonCopies: chkInlineCopies.checked,
    showInlineButton: chkShowInline.checked,
    inlineStats: chkInlineStats.checked,
    obsidianFriendly: chkObsidianFriendly.checked,
    obsidianVault: txtObsidianVault.value.trim(),
  });
}

chkDownloadImages.addEventListener('change', persistAll);
chkMetadata.addEventListener('change', persistAll);
chkCloseTab.addEventListener('change', persistAll);
chkInlineCopies.addEventListener('change', persistAll);
chkShowInline.addEventListener('change', () => {
  updateInlineCopiesEnabled();
  persistAll();
});
chkInlineStats.addEventListener('change', persistAll);
chkObsidianFriendly.addEventListener('change', persistAll);
txtObsidianVault.addEventListener('change', persistAll);
txtObsidianVault.addEventListener('blur', persistAll);

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

function setLoading(loading: boolean, target?: 'download' | 'copy' | 'obsidian'): void {
  btnDownload.disabled = loading;
  btnCopy.disabled = loading;
  btnObsidian.disabled = loading;

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
  if (target === 'obsidian' || !target) {
    btnObsidian.classList.toggle('loading', loading);
    const obLabel = btnObsidian.querySelector('.btn-label');
    if (obLabel) obLabel.textContent = loading ? (chrome.i18n.getMessage('extracting') || 'Extracting…') : (chrome.i18n.getMessage('btn_obsidian') || 'Add to Obsidian');
  }

  // When stopping, always reset all three to default state
  if (!loading) {
    btnDownload.classList.remove('loading');
    btnCopy.classList.remove('loading');
    btnObsidian.classList.remove('loading');
    const dlLabel = btnDownload.querySelector('.btn-label');
    const cpLabel = btnCopy.querySelector('.btn-label');
    const obLabel = btnObsidian.querySelector('.btn-label');
    if (dlLabel) dlLabel.textContent = chrome.i18n.getMessage('btn_download') || 'Download .md';
    if (cpLabel) cpLabel.textContent = chrome.i18n.getMessage('btn_copy') || 'Copy .md';
    if (obLabel) obLabel.textContent = chrome.i18n.getMessage('btn_obsidian') || 'Add to Obsidian';
  }
}

// ─── Shared Extraction ──────────────────────────────────────────────

async function extractMarkdown(
  forAction: 'download' | 'copy' | 'obsidian' = 'download',
): Promise<PostProcessResult> {
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
  const inlineStats = chkInlineStats.checked;
  // "Add to Obsidian" is *the* Obsidian path — force the Obsidian schema
  // regardless of the toggle (the toggle exists for the Download/Copy
  // flows where the user may or may not be heading to Obsidian).
  const obsidianFriendly = forAction === 'obsidian' ? true : chkObsidianFriendly.checked;
  // Local image folders make no sense for the deeplink — Obsidian receives
  // markdown via URL, not a filesystem package, so leave images as remote
  // URLs (Obsidian renders pbs.twimg.com inline fine).
  const downloadImages =
    forAction === 'obsidian' ? false : resolveDownloadImages(forAction, chkDownloadImages.checked);

  const response: ExtractResponse = await chrome.tabs.sendMessage(tab.id, {
    action: 'EXTRACT',
    // Need engagement data if either renderer wants it.
    includeMetadata: includeMetadata || inlineStats,
  });

  if (!response.success || !response.data) {
    throw new Error(response.error || chrome.i18n.getMessage('error_failed') || 'Failed to extract content.');
  }

  return postProcess(response.data, { includeMetadata, downloadImages, inlineStats, obsidianFriendly });
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

// ─── Add to Obsidian Flow ───────────────────────────────────────────

function buildObsidianUrl(
  content: string,
  filename: string,
  vault: string
): string {
  const fileNoExt = filename.replace(/\.md$/, '');
  const params = new URLSearchParams();
  if (vault) params.set('vault', vault);
  params.set('file', fileNoExt);
  params.set('content', content);
  return `obsidian://new?${params.toString()}`;
}

btnObsidian.addEventListener('click', async () => {
  setLoading(true, 'obsidian');
  statusEl.className = 'status hidden';

  try {
    const result = await extractMarkdown('obsidian');
    const vault = txtObsidianVault.value.trim();
    const url = buildObsidianUrl(result.markdown, result.filename, vault);

    // Navigate the popup itself to the obsidian:// URL. The OS handler picks
    // it up; the popup closes either way, so we don't leave a blank tab.
    window.location.href = url;

    showStatus(`✓ ${chrome.i18n.getMessage('obsidian_opened') || 'Opening Obsidian…'}`, 'success');
    setLoading(false);
  } catch (err) {
    handleExtractionError(err);
  }
});

btnCopy.addEventListener('click', async () => {
  setLoading(true, 'copy');
  statusEl.className = 'status hidden';

  try {
    const result = await extractMarkdown('copy');

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
