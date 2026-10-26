// The four export flows (Download / Copy / PDF / Add to Obsidian) plus the
// shared extraction call and the status/loading UI they drive. Reads the user's
// current selections from the DOM refs and the settings-form field maps; it
// does not own any settings state.

import type {
  ExtractResponse,
  DownloadRequest,
  DownloadResponse,
  ExtractedContent,
  ResolveVideoUrlsResponse,
  SingleExportClaimMessage,
  SingleExportDownloadMessage,
  SingleExportDownloadedMessage,
  SingleExportRequest,
  SingleExportResultMessage,
  SingleExportState,
  SingleExportTarget,
} from '../types/messages';
import { SINGLE_EXPORT_PORT } from '../types/messages';
import { postProcess, markdownOptions, buildFilename, type PostProcessResult } from '../shared/post-process';
import { buildFormatExport, type ExportFormat } from '../shared/export-formats';
import { recordExport } from '../shared/review-prompt';
import { buildObsidianUrl } from '../shared/obsidian';
import { hostMatches } from '../shared/media';
import { renderMarkdown } from '../ast/render-markdown';
import { resolveLocalVideo, type VideoAttachment } from '../shared/local-video';
import { currentFrontmatterFields, readSingleFormat, applySingleFormat, persistAll, readSettingsForm, saveLocalMediaEnabled } from './settings-form';
import type { BatchFormat } from '../shared/settings';
import {
  btnDownload,
  btnCopy,
  chkZip,
  btnPdf,
  btnObsidian,
  fmtButtons,
  btnFmtTrigger,
  fmtMenu,
  statusEl,
  chkMetadata,
  chkInlineStats,
  chkObsidianFriendly,
  txtFilenameTemplate,
  txtObsidianTags,
  txtObsidianVault,
  txtObsidianFolder,
} from './dom';

// Every button the export flows disable while one of them is running, so a
// second click can't race an in-flight extraction (the format selectors too,
// so the target format can't change mid-flight).
const allExportButtons = [btnDownload, btnCopy, btnPdf, btnObsidian, btnFmtTrigger, ...fmtButtons];

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

// The popup's port to the tab's content script (issue #191). Chrome closes it
// when the popup closes. Then the content script does the last step of an
// export that the popup did not claim. null when the tab has no content script.
let tabPort: chrome.runtime.Port | null = null;
let tabPortReady: Promise<void> = Promise.resolve();
let onExtractResult: ((response: ExtractResponse | 'busy' | undefined) => void) | null = null;
let onDownloadResult: ((error: string | null) => void) | null = null;

async function connectToTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // Not only on /status/ pages: the user can move to another x.com page while
  // an export runs, and the content script stays in that tab.
  if (!tab?.id || !hostMatches(tab.url || '', 'x.com', 'www.x.com')) return;

  const port = chrome.tabs.connect(tab.id, { name: SINGLE_EXPORT_PORT });
  port.onMessage.addListener((msg: SingleExportResultMessage | SingleExportDownloadedMessage | SingleExportState) => {
    if (msg.action === 'SINGLE_EXPORT_RESULT') {
      onExtractResult?.(msg.response);
      onExtractResult = null;
    } else if (msg.action === 'SINGLE_EXPORT_DOWNLOADED') {
      onDownloadResult?.(msg.error);
      onDownloadResult = null;
    } else if (msg.busy) {
      // An export from a closed popup still runs in this tab. A click that
      // came before this message gets no export of its own.
      onExtractResult?.('busy');
      onExtractResult = null;
      setLoading(false);
      setLoading(true, msg.busy);
    } else {
      setLoading(false);
    }
  });
  port.onDisconnect.addListener(() => {
    // No content script answers, for example an old one after an extension
    // reload. Reading lastError stops Chrome from logging it.
    void chrome.runtime.lastError;
    tabPort = null;
    onExtractResult?.(undefined);
    onExtractResult = null;
    onDownloadResult?.(chrome.i18n.getMessage('download_failed') || 'Download failed.');
    onDownloadResult = null;
  });
  tabPort = port;
}

// Tell the content script that the popup does the last step now, so the
// content script does not do it too when the popup closes. Send it after
// every slow step and immediately before the clipboard write.
function claimExport(): void {
  const msg: SingleExportClaimMessage = { action: 'SINGLE_EXPORT_CLAIM' };
  tabPort?.postMessage(msg);
}

// Download through the content script, which also claims the export. The
// background can take long to answer (zip mode fetches the media first), and
// if the popup closes before then, the content script shows the answer in a
// toast. Resolves to the error to show, or null when the download started.
async function downloadThroughTab(request: DownloadRequest): Promise<string | null> {
  const port = tabPort;
  if (!port) {
    const response: DownloadResponse | undefined = await chrome.runtime.sendMessage(request);
    return response?.success ? null : response?.error || chrome.i18n.getMessage('download_failed') || 'Download failed.';
  }
  return new Promise((resolve) => {
    onDownloadResult = resolve;
    const msg: SingleExportDownloadMessage = { action: 'SINGLE_EXPORT_DOWNLOAD', request };
    port.postMessage(msg);
  });
}

// Shared up-front guard + extraction: resolve the active tab, confirm it's a
// specific X.com status page, and ask the content script for the post. Both
// the Markdown flows and the alternate-format exports build on the
// ExtractedContent it returns.
async function extractContent(target: SingleExportTarget, format: BatchFormat): Promise<ExtractedContent> {
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

  await tabPortReady;
  const port = tabPort;
  const response = port
    ? await new Promise<ExtractResponse | 'busy' | undefined>((resolve) => {
        onExtractResult = resolve;
        const request: SingleExportRequest = { action: 'SINGLE_EXPORT', target, format, settings: readSettingsForm() };
        port.postMessage(request);
      })
    : undefined;

  // After an extension reload the content script already in the tab is
  // orphaned and can't answer, so the port closes without a result. Surface
  // the "reload the page" hint.
  if (response === 'busy') throw new ExportBusyError();
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
  const opts = markdownOptions(readSettingsForm(), forAction);

  const data = await extractContent(forAction, 'md');

  return postProcess(data, {
    ...opts,
    videoAttachments: opts.downloadImages ? await localVideoAttachments(data) : undefined,
  });
}

// Turn this post's videos into local files, when the user asked for Media.
//
// The Markdown is re-rendered from the filled-in AST so its [▶ Video] link
// points at the file we're about to save. Re-rendering is safe because the
// content script renders with no options — includeVideoLinks is the only
// difference between the two passes.
//
// A post that HAS video and still didn't resolve says so, because silently
// shipping the thumbnail is the one outcome the user can't tell apart from
// success until they open the folder.
async function localVideoAttachments(data: ExtractedContent): Promise<VideoAttachment[] | undefined> {
  if (!saveLocalMediaEnabled() || !data.body) return undefined;

  const result = await resolveLocalVideo(data.body, data.tweetId, async (tweetId) => {
    const response: ResolveVideoUrlsResponse | undefined = await chrome.runtime.sendMessage({
      action: 'RESOLVE_VIDEO_URLS',
      tweetId,
    });
    return response?.urls ?? [];
  });
  if (result.status === 'none') return undefined;
  if (result.status === 'unresolved') {
    showStatus(
      chrome.i18n.getMessage('video_unresolved') ||
        'Video kept as a link — reload the post once, then export again.',
      'info'
    );
    return undefined;
  }

  data.markdown = renderMarkdown(data.body, { includeVideoLinks: true });
  return result.attachments;
}

// Another export still runs in this tab, and the popup already shows it as
// busy (SINGLE_EXPORT_STATE). Not an error to show.
class ExportBusyError extends Error {}

function handleExtractionError(err: unknown): void {
  if (err instanceof ExportBusyError) return;
  // The popup shows the error, so the content script must not try the export
  // again when the popup closes.
  claimExport();
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
  tabPortReady = connectToTab();

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
      fmtMenu.hidePopover();
    });
  }
  fmtMenu.addEventListener('toggle', (e) => {
    if ((e as ToggleEvent).newState === 'open') {
      fmtButtons.find((b) => b.getAttribute('aria-checked') === 'true')?.focus();
    }
  });
  fmtMenu.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = fmtButtons.indexOf(document.activeElement as HTMLButtonElement);
    fmtButtons[(i + step + fmtButtons.length) % fmtButtons.length].focus();
  });

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
      claimExport();
      const vault = txtObsidianVault.value.trim();
      const folder = txtObsidianFolder.value.trim();
      const url = buildObsidianUrl(result.filename, vault, folder);
      // Obsidian reads the note from the clipboard. If the copy failed,
      // opening it would make a note out of whatever the clipboard held before.
      try {
        await navigator.clipboard.writeText(result.markdown);
      } catch {
        throw new Error(chrome.i18n.getMessage('obsidian_copy_failed') || 'Couldn’t copy the note to the clipboard, so Obsidian wasn’t opened. Try again.');
      }
      void recordExport();

      // Navigate the popup itself to the obsidian:// URL. The OS handler picks
      // it up; the popup closes either way, so we don't leave a blank tab.
      window.location.href = url;

      showStatus(`✓ ${chrome.i18n.getMessage('obsidian_opened') || 'Note copied to clipboard. Opening Obsidian…'}`, 'success');
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

    // Zip only earns its keep when there is media to keep together with the
    // Markdown — a lone .md in an archive is just an extra step for the user.
    const downloadMsg: DownloadRequest = {
      action: 'DOWNLOAD_MD',
      content: result.markdown,
      filename: result.filename,
      images: result.images.length > 0 ? result.images : undefined,
      zip: chkZip.checked && result.images.length > 0,
    };

    const error = await downloadThroughTab(downloadMsg);
    if (error) {
      showStatus(error, 'error');
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
    claimExport();

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
    const data = await extractContent(action, format);
    const obsidianFriendly = chkObsidianFriendly.checked;
    const exported = buildFormatExport(format, data, {
      includeEngagement: chkInlineStats.checked,
      obsidianFriendly,
      frontmatterFields: currentFrontmatterFields(obsidianFriendly),
      obsidianTagsTemplate: txtObsidianTags.value.trim(),
      includeMetadata: chkMetadata.checked,
    });

    if (action === 'copy') {
      claimExport();
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

    const error = await downloadThroughTab(downloadMsg);
    if (error) {
      showStatus(error, 'error');
    } else {
      showStatus(`✓ .${exported.ext} ${chrome.i18n.getMessage('downloaded') || 'Downloaded!'}`, 'success');
      void recordExport();
    }
    setLoading(false);
  } catch (err) {
    handleExtractionError(err);
  }
}
