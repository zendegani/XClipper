// The four export flows (Download / Copy / PDF / Add to Obsidian) plus the
// shared extraction call and the status/loading UI they drive. Reads the user's
// current selections from the DOM refs and the settings-form field maps; it
// does not own any settings state.

import type { ExtractResponse, DownloadRequest, ExtractedContent } from '../types/messages';
import { postProcess, resolveDownloadImages, buildFilename, type PostProcessResult } from '../shared/post-process';
import { buildFormatExport, type ExportFormat } from '../shared/export-formats';
import { recordExport } from '../shared/review-prompt';
import { buildObsidianUrl } from '../shared/obsidian';
import { hostMatches } from '../shared/media';
import { currentFrontmatterFields, readSingleFormat, applySingleFormat, persistAll } from './settings-form';
import type { BatchFormat } from '../shared/settings';
import {
  btnDownload,
  btnCopy,
  btnPdf,
  btnObsidian,
  fmtButtons,
  statusEl,
  chkMetadata,
  chkInlineStats,
  chkObsidianFriendly,
  chkDownloadImages,
  txtFilenameTemplate,
  txtObsidianTags,
  txtObsidianVault,
  txtObsidianFolder,
} from './dom';

// Every button the export flows disable while one of them is running, so a
// second click can't race an in-flight extraction (the format selectors too,
// so the target format can't change mid-flight).
const allExportButtons = [btnDownload, btnCopy, btnPdf, btnObsidian, ...fmtButtons];

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

function setLoading(loading: boolean, target?: 'download' | 'copy' | 'obsidian' | 'pdf'): void {
  for (const btn of allExportButtons) btn.disabled = loading;

  // Only animate the button that was actually clicked
  if (target === 'download' || !target) {
    btnDownload.classList.toggle('loading', loading);
    const dlLabel = btnDownload.querySelector('.btn-label');
    if (dlLabel) dlLabel.textContent = loading ? (chrome.i18n.getMessage('extracting') || 'Extracting…') : (chrome.i18n.getMessage('btn_download') || 'Download');
  }
  if (target === 'copy' || !target) {
    btnCopy.classList.toggle('loading', loading);
    const cpLabel = btnCopy.querySelector('.btn-label');
    if (cpLabel) cpLabel.textContent = loading ? (chrome.i18n.getMessage('extracting') || 'Extracting…') : (chrome.i18n.getMessage('btn_copy') || 'Copy');
  }
  if (target === 'obsidian' || !target) {
    btnObsidian.classList.toggle('loading', loading);
    const obLabel = btnObsidian.querySelector('.btn-label');
    if (obLabel) obLabel.textContent = loading ? (chrome.i18n.getMessage('extracting') || 'Extracting…') : (chrome.i18n.getMessage('btn_obsidian') || 'Add to Obsidian');
  }
  if (target === 'pdf' || !target) {
    btnPdf.classList.toggle('loading', loading);
    const pdfLabel = btnPdf.querySelector('.btn-label');
    if (pdfLabel) pdfLabel.textContent = loading ? (chrome.i18n.getMessage('rendering_pdf') || 'Rendering PDF…') : (chrome.i18n.getMessage('btn_pdf') || 'Export .pdf');
  }

  // When stopping, always reset all four to default state
  if (!loading) {
    btnDownload.classList.remove('loading');
    btnCopy.classList.remove('loading');
    btnObsidian.classList.remove('loading');
    btnPdf.classList.remove('loading');
    const dlLabel = btnDownload.querySelector('.btn-label');
    const cpLabel = btnCopy.querySelector('.btn-label');
    const obLabel = btnObsidian.querySelector('.btn-label');
    const pdfLabel = btnPdf.querySelector('.btn-label');
    if (dlLabel) dlLabel.textContent = chrome.i18n.getMessage('btn_download') || 'Download';
    if (cpLabel) cpLabel.textContent = chrome.i18n.getMessage('btn_copy') || 'Copy';
    if (obLabel) obLabel.textContent = chrome.i18n.getMessage('btn_obsidian') || 'Add to Obsidian';
    if (pdfLabel) pdfLabel.textContent = chrome.i18n.getMessage('btn_pdf') || 'Export .pdf';
  }
}

// Shared up-front guard + extraction: resolve the active tab, confirm it's a
// specific X.com status page, and run EXTRACT. Both the Markdown flows and the
// alternate-format exports build on the ExtractedContent it returns.
async function extractContent(includeMetadata: boolean): Promise<ExtractedContent> {
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

  const response: ExtractResponse | undefined = await chrome.tabs.sendMessage(tab.id, {
    action: 'EXTRACT',
    includeMetadata,
  });

  // After an extension reload the content script already in the tab is
  // orphaned: its async EXTRACT handler can't answer, so tabs.sendMessage
  // resolves `undefined` (instead of rejecting with "Receiving end does not
  // exist"). Surface the same "reload the page" hint rather than letting a
  // raw `undefined.success` TypeError leak through.
  if (!response) {
    throw new Error(chrome.i18n.getMessage('error_reload') || 'Reload the page and try again.');
  }
  if (!response.success || !response.data) {
    throw new Error(response.error || chrome.i18n.getMessage('error_failed') || 'Failed to extract content.');
  }

  return response.data;
}

async function extractMarkdown(
  forAction: 'download' | 'copy' | 'obsidian' = 'download',
): Promise<PostProcessResult> {
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

  // Need engagement data if either renderer wants it.
  const data = await extractContent(includeMetadata || inlineStats);

  return postProcess(data, {
    includeMetadata,
    downloadImages,
    inlineStats,
    obsidianFriendly,
    filenameTemplate: txtFilenameTemplate.value.trim(),
    obsidianTagsTemplate: txtObsidianTags.value.trim(),
    frontmatterFields: currentFrontmatterFields(obsidianFriendly),
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

// Wires the four export buttons. Call once on popup open.
export function initActions(): void {
  // ─── Download / Copy: dispatch on the selected format ───
  // '.md' runs the full Markdown pipeline (frontmatter, local images, filename
  // template); the other four go through buildFormatExport.
  btnDownload.addEventListener('click', () => {
    const fmt = readSingleFormat();
    if (fmt === 'md') void runMarkdownDownload();
    else void runFormatExport(fmt, 'download');
  });
  btnCopy.addEventListener('click', () => {
    const fmt = readSingleFormat();
    if (fmt === 'md') void runMarkdownCopy();
    else void runFormatExport(fmt, 'copy');
  });

  // ─── Format selector: activate + persist the clicked format ───
  for (const btn of fmtButtons) {
    btn.addEventListener('click', () => {
      applySingleFormat(btn.dataset.format as BatchFormat);
      persistAll();
    });
  }

  // ─── PDF Export Flow ───
  btnPdf.addEventListener('click', async () => {
    setLoading(true, 'pdf');
    statusEl.className = 'status hidden';
    try {
      const [tab] = await new Promise<chrome.tabs.Tab[]>((resolve) =>
        chrome.tabs.query({ active: true, currentWindow: true }, resolve)
      );
      if (!tab?.id) {
        showStatus(chrome.i18n.getMessage('error_no_tab') || 'No active tab.', 'error');
        setLoading(false);
        return;
      }
      // Same up-front host check as the markdown/copy/obsidian flow — without
      // it, sendMessage falls through to "Receiving end does not exist" and the
      // user gets the misleading "Reload the page and try again" hint.
      const url = tab.url || '';
      if (!hostMatches(url, 'x.com', 'www.x.com')) {
        showStatus(
          chrome.i18n.getMessage('footer_hint') || 'Navigate to a tweet or article on X.com first.',
          'error',
        );
        setLoading(false);
        return;
      }
      if (!url.includes('/status/')) {
        showStatus(
          chrome.i18n.getMessage('error_specific_page') ||
            'Open a specific tweet or article page (with /status/ in the URL).',
          'error',
        );
        setLoading(false);
        return;
      }
      chrome.tabs.sendMessage(tab.id, { action: 'EXPORT_PDF' }, (resp) => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || '';
          // Same friendly hint as the markdown flow: content script isn't on
          // this page (non-/status/ URL or just-reloaded extension).
          if (msg.includes('Receiving end does not exist')) {
            showStatus(chrome.i18n.getMessage('error_reload') || 'Reload the page and try again.', 'error');
          } else {
            showStatus(msg || 'PDF export failed.', 'error');
          }
        } else if (!resp?.success) {
          showStatus(resp?.error || chrome.i18n.getMessage('pdf_failed') || 'PDF export failed.', 'error');
        } else {
          showStatus(`✓ ${chrome.i18n.getMessage('pdf_downloaded') || 'PDF downloaded!'}`, 'success');
          void recordExport();
        }
        setLoading(false);
      });
    } catch (err) {
      handleExtractionError(err);
    }
  });

  // ─── Add to Obsidian Flow ───
  btnObsidian.addEventListener('click', async () => {
    setLoading(true, 'obsidian');
    statusEl.className = 'status hidden';

    try {
      const result = await extractMarkdown('obsidian');
      const vault = txtObsidianVault.value.trim();
      const folder = txtObsidianFolder.value.trim();
      const url = buildObsidianUrl(result.markdown, result.filename, vault, folder);
      void recordExport();

      // Navigate the popup itself to the obsidian:// URL. The OS handler picks
      // it up; the popup closes either way, so we don't leave a blank tab.
      window.location.href = url;

      showStatus(`✓ ${chrome.i18n.getMessage('obsidian_opened') || 'Opening Obsidian…'}`, 'success');
      setLoading(false);
    } catch (err) {
      handleExtractionError(err);
    }
  });

}

// ─── Markdown Download (.md) ───
async function runMarkdownDownload(): Promise<void> {
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
        void recordExport();
      }
      setLoading(false);
    });
  } catch (err) {
    handleExtractionError(err);
  }
}

// ─── Markdown Copy (.md) ───
async function runMarkdownCopy(): Promise<void> {
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
}

// Build one of the alternate formats (HTML / JSON / TXT / CSV) from the current
// page and either download it or copy it to the clipboard. Metadata is always
// requested so CSV/JSON/HTML have engagement counts available regardless of the
// popup toggles.
async function runFormatExport(format: ExportFormat, action: 'download' | 'copy'): Promise<void> {
  setLoading(true, action);
  statusEl.className = 'status hidden';

  try {
    const data = await extractContent(true);
    const obsidianFriendly = chkObsidianFriendly.checked;
    const exported = buildFormatExport(format, data, {
      includeEngagement: chkInlineStats.checked,
      obsidianFriendly,
      frontmatterFields: currentFrontmatterFields(obsidianFriendly),
      obsidianTagsTemplate: txtObsidianTags.value.trim(),
      includeMetadata: chkMetadata.checked,
    });

    if (action === 'copy') {
      await navigator.clipboard.writeText(exported.content);
      showStatus(`✓ .${exported.ext} ${chrome.i18n.getMessage('copied') || 'Copied!'}`, 'success');
      void recordExport();
      setLoading(false);
      return;
    }

    const filename = buildFilename(data, txtFilenameTemplate.value.trim()).replace(/\.md$/i, `.${exported.ext}`);

    const downloadMsg: DownloadRequest = {
      action: 'DOWNLOAD_MD',
      content: exported.content,
      filename,
      mime: exported.mime,
    };

    chrome.runtime.sendMessage(downloadMsg, (downloadResponse) => {
      if (chrome.runtime.lastError || !downloadResponse?.success) {
        showStatus(downloadResponse?.error || chrome.i18n.getMessage('download_failed') || 'Download failed.', 'error');
      } else {
        showStatus(`✓ .${exported.ext} ${chrome.i18n.getMessage('downloaded') || 'Downloaded!'}`, 'success');
        void recordExport();
      }
      setLoading(false);
    });
  } catch (err) {
    handleExtractionError(err);
  }
}
