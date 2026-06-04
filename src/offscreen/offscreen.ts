import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import type { OffscreenRenderPdfRequest, PdfRenderResponse } from '../types/messages';

// Offscreen-document PDF renderer.
//
// Lives at chrome-extension://<id>/offscreen.html — extension origin, so
// html2canvas's offscreen iframe inherits the extension's CSP, not x.com's.
// The X.com page's <script src="…twimg.com…"> tags never enter our DOM
// here, so they don't tangle with the clone.
//
// Receives the rendered fragment HTML + filename base from the background
// worker, renders to canvas, builds the PDF with jsPDF.addImage (paged), and
// triggers a download via chrome.downloads. Returns success/error.

const RENDER_WIDTH_PX = 680;
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PAGE_MARGIN_MM = 10;
const CONTENT_WIDTH_MM = A4_WIDTH_MM - 2 * PAGE_MARGIN_MM;
const CONTENT_HEIGHT_MM = A4_HEIGHT_MM - 2 * PAGE_MARGIN_MM;
const RENDER_TIMEOUT_MS = 60000;
const IMAGE_LOAD_TIMEOUT_MS = 15000;
const SETTINGS_KEY = 'tweet2md_settings';

const osLog = (...args: unknown[]): void => console.log('[t2m offscreen]', ...args);

osLog('offscreen.js loaded, registering listener');

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Handshake: background pings to confirm this listener is wired before
  // it forwards the heavy PDF payload.
  if (msg?.action === 'OFFSCREEN_PING') {
    osLog('ping received');
    sendResponse({ pong: true });
    return false;
  }
  if (msg?.action !== 'OFFSCREEN_RENDER_PDF') return false;
  const typed = msg as OffscreenRenderPdfRequest;
  osLog('OFFSCREEN_RENDER_PDF received, html length =', typed.html.length);
  renderPdf(typed.html, typed.filenameBase).then(
    () => {
      osLog('renderPdf success');
      sendResponse({ success: true } satisfies PdfRenderResponse);
    },
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      osLog('renderPdf error:', message);
      sendResponse({ success: false, error: message } satisfies PdfRenderResponse);
    },
  );
  return true; // keep channel open for async sendResponse
});

async function renderPdf(html: string, filenameBase: string): Promise<void> {
  const host = document.getElementById('render-host');
  if (!host) throw new Error('Offscreen render-host missing');

  // renderPdfFragment escapes every user-derived value via escapeHtml/
  // escapeAttr — see src/ast/render-pdf-html.ts. The HTML is not subject to
  // XSS from tweet content. The offscreen page is extension-owned and
  // never reachable from the web, so this DOM injection is safe.
  host.innerHTML = html;
  try {
    await waitForImages(host);

    const canvas = await withTimeout(
      html2canvas(host, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        windowWidth: RENDER_WIDTH_PX,
      }),
      RENDER_TIMEOUT_MS,
      'PDF render timed out after 60s',
    );

    const imgWidthMm = CONTENT_WIDTH_MM;
    const imgHeightMm = (canvas.height / canvas.width) * imgWidthMm;
    const imgData = canvas.toDataURL('image/jpeg', 0.92);

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    let yOffset = 0;
    while (yOffset < imgHeightMm) {
      pdf.addImage(
        imgData,
        'JPEG',
        PAGE_MARGIN_MM,
        PAGE_MARGIN_MM - yOffset,
        imgWidthMm,
        imgHeightMm,
      );
      yOffset += CONTENT_HEIGHT_MM;
      if (yOffset < imgHeightMm) pdf.addPage();
    }

    await downloadPdf(pdf, filenameBase);
  } finally {
    host.innerHTML = '';
  }
}

async function downloadPdf(pdf: jsPDF, filenameBase: string): Promise<void> {
  const folder = await loadDownloadFolder();
  const filename = sanitizeFilename(folder, filenameBase);

  // Blob URLs created here are bound to the offscreen origin, but
  // chrome.downloads.download can resolve them since the call is made from
  // the same origin. Revoke on completion to avoid leaking.
  const blob = pdf.output('blob');
  const url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      chrome.downloads.download({ url, filename, saveAs: false }, (id) => {
        if (chrome.runtime.lastError || typeof id !== 'number') {
          reject(new Error(chrome.runtime.lastError?.message || 'Download failed'));
          return;
        }
        resolve();
      });
    });
  } finally {
    // Delay revoke so Chrome has time to start the download stream.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

function loadDownloadFolder(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get(SETTINGS_KEY, (result) => {
      const settings = result[SETTINGS_KEY] as { downloadFolder?: unknown } | undefined;
      const folder =
        settings && typeof settings.downloadFolder === 'string' ? settings.downloadFolder : '';
      resolve(folder);
    });
  });
}

// Minimal local copy of the sanitization the background uses for .md
// downloads — keep behavior aligned without pulling background-only deps.
function sanitizeFilename(folder: string, base: string): string {
  const combined = (folder ? folder.replace(/\/+$/, '') + '/' : '') + base + '.pdf';
  return combined
    .replace(/\.\./g, '')          // no parent-dir traversal
    .replace(/^\/+/, '')           // no absolute paths
    .replace(/[<>:"|?*\x00-\x1f]/g, '_'); // illegal filename chars
}

function waitForImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'));
  if (imgs.length === 0) return Promise.resolve();
  osLog(`waiting for ${imgs.length} image(s)…`);
  // Per-image timeout — if an <img> never fires load or error (rare but seen
  // with hung connections), don't block the whole PDF.
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          const done = (): void => {
            clearTimeout(t);
            resolve();
          };
          const t = setTimeout(done, IMAGE_LOAD_TIMEOUT_MS);
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
        }),
    ),
  ).then(() => {
    osLog('images settled');
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
