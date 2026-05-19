import type { ExtractResponse, DownloadRequest } from '../types/messages';
import { postProcess, resolveDownloadImages, buildFilename, type PostProcessResult } from '../shared/post-process';
import { buildObsidianUrl } from '../shared/obsidian';
import { hostMatches } from '../shared/media';

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
const txtDownloadFolder = document.getElementById(
  'txt-download-folder'
) as HTMLInputElement;
const txtObsidianFolder = document.getElementById(
  'txt-obsidian-folder'
) as HTMLInputElement;
const txtFilenameTemplate = document.getElementById(
  'txt-filename-template'
) as HTMLInputElement;
const filenamePreview = document.getElementById(
  'filename-preview'
) as HTMLElement;

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
document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
  const key = el.getAttribute('data-i18n-aria-label');
  if (key) {
    const msg = chrome.i18n.getMessage(key);
    if (msg) el.setAttribute('aria-label', msg);
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
  btnSettings?.classList.add('hidden');
});
btnBack?.addEventListener('click', () => {
  viewSettings?.classList.add('hidden');
  viewMain?.classList.remove('hidden');
  btnSettings?.classList.remove('hidden');
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
  obsidianFolder: string;
  downloadFolder: string;
  filenameTemplate: string;
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
  obsidianFolder: '', // empty → create note at the vault root
  downloadFolder: '', // empty → save directly in Downloads
  filenameTemplate: '', // empty → legacy {handle}-{id}.md / {handle}-{slug}.md
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
  txtObsidianFolder.value = settings.obsidianFolder;
  txtDownloadFolder.value = settings.downloadFolder;
  txtFilenameTemplate.value = settings.filenameTemplate;
  updateFilenamePreview();
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
    obsidianFolder: txtObsidianFolder.value.trim(),
    downloadFolder: txtDownloadFolder.value.trim(),
    filenameTemplate: txtFilenameTemplate.value.trim(),
  });
}

// ─── Filename template preview ─────────────────────────────────────

const PREVIEW_SAMPLE = {
  type: 'thread' as const,
  author: { name: 'Jane Doe', handle: '@janedoe' },
  markdown: '# Jane Doe (@janedoe)\n\nThe quick brown fox jumps over the lazy dog.',
  sourceUrl: 'https://x.com/janedoe/status/1234567890',
  date: '2026-05-19T14:30:00.000Z',
  tweetId: '1234567890',
};

function updateFilenamePreview(): void {
  if (!filenamePreview) return;
  const template = txtFilenameTemplate.value.trim();
  filenamePreview.textContent = buildFilename(PREVIEW_SAMPLE, template);
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
txtDownloadFolder.addEventListener('change', persistAll);
txtDownloadFolder.addEventListener('blur', persistAll);
txtObsidianFolder.addEventListener('change', persistAll);
txtObsidianFolder.addEventListener('blur', persistAll);
txtFilenameTemplate.addEventListener('input', updateFilenamePreview);
txtFilenameTemplate.addEventListener('change', persistAll);
txtFilenameTemplate.addEventListener('blur', persistAll);

// ─── Filename template hint popover ────────────────────────────────

const btnFilenameInfo = document.getElementById('btn-filename-info') as HTMLButtonElement | null;
btnFilenameInfo?.addEventListener('click', (e) => {
  e.preventDefault();
  const expanded = btnFilenameInfo.getAttribute('aria-expanded') === 'true';
  btnFilenameInfo.setAttribute('aria-expanded', expanded ? 'false' : 'true');
});
document.addEventListener('click', (e) => {
  if (!btnFilenameInfo) return;
  if (btnFilenameInfo.getAttribute('aria-expanded') !== 'true') return;
  const target = e.target as Node;
  if (btnFilenameInfo.contains(target)) return;
  const hint = document.getElementById('filename-template-hint');
  if (hint?.contains(target)) return;
  btnFilenameInfo.setAttribute('aria-expanded', 'false');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && btnFilenameInfo?.getAttribute('aria-expanded') === 'true') {
    btnFilenameInfo.setAttribute('aria-expanded', 'false');
  }
});

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
  if (!hostMatches(url, 'x.com', 'www.x.com')) {
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

  return postProcess(response.data, {
    includeMetadata,
    downloadImages,
    inlineStats,
    obsidianFriendly,
    filenameTemplate: txtFilenameTemplate.value.trim(),
  });
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

btnObsidian.addEventListener('click', async () => {
  setLoading(true, 'obsidian');
  statusEl.className = 'status hidden';

  try {
    const result = await extractMarkdown('obsidian');
    const vault = txtObsidianVault.value.trim();
    const folder = txtObsidianFolder.value.trim();
    const url = buildObsidianUrl(result.markdown, result.filename, vault, folder);

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
