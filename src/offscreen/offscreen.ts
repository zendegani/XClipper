import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import type {
  OffscreenRenderPdfRequest,
  OffscreenRenderPdfResponse,
} from '../types/messages';

// Offscreen-document PDF renderer.
//
// Lives at chrome-extension://<id>/offscreen.html — extension origin, so
// html2canvas's offscreen-iframe clone never touches X.com's <script>
// tags (the blocker for in-content rendering).
//
// Current implementation is RASTER (html2canvas → addImage), which produces
// the visually-correct Twitter-card layout but means text isn't real
// selectable PDF text. Per ADR 0001 the long-term target is selectable
// vector text; jsPDF.html() can do that but needs (a) a custom embedded
// Unicode font (default jsPDF font is Latin-1, mangles emoji + non-ASCII)
// and (b) page-boundary-aware autoPaging. Tracked as a follow-up; macOS
// Preview's live OCR keeps text selectable in the meantime.
//
// Offscreen documents only have access to chrome.runtime reliably;
// chrome.storage and chrome.downloads belong to the background worker.

const RENDER_WIDTH_PX = 680;
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PAGE_MARGIN_MM = 10;
const CONTENT_WIDTH_MM = A4_WIDTH_MM - 2 * PAGE_MARGIN_MM;
const CONTENT_HEIGHT_MM = A4_HEIGHT_MM - 2 * PAGE_MARGIN_MM;
const RENDER_TIMEOUT_MS = 60000;
const IMAGE_LOAD_TIMEOUT_MS = 5000;

const osLog = (...args: unknown[]): void => console.log('[t2m offscreen]', ...args);
osLog('offscreen.js loaded, registering listener');

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action === 'OFFSCREEN_PING') {
    osLog('ping received');
    sendResponse({ pong: true });
    return false;
  }
  if (msg?.action !== 'OFFSCREEN_RENDER_PDF') return false;
  const typed = msg as OffscreenRenderPdfRequest;
  osLog('OFFSCREEN_RENDER_PDF received, html length =', typed.html.length);
  renderPdfDataUrl(typed.html).then(
    (dataUrl) => {
      osLog('renderPdf success, dataUrl length =', dataUrl.length);
      sendResponse({ success: true, dataUrl } satisfies OffscreenRenderPdfResponse);
    },
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      osLog('renderPdf error:', message);
      sendResponse({ success: false, error: message } satisfies OffscreenRenderPdfResponse);
    },
  );
  return true; // async
});

async function renderPdfDataUrl(html: string): Promise<string> {
  const host = document.getElementById('render-host');
  if (!host) throw new Error('Offscreen render-host missing');

  const t0 = performance.now();
  // renderPdfFragment escapes every user-derived value (text, URLs, alts,
  // titles) via escapeHtml/escapeAttr — see src/ast/render-pdf-html.ts.
  host.innerHTML = html;
  try {
    await waitForImages(host);
    const tImages = performance.now();
    osLog(`waitForImages: ${(tImages - t0).toFixed(0)}ms`);

    // scale=1.5 balances sharpness with raster cost. scale=2 was 4× the
    // pixel area for ~10% perceptible-detail gain on body text.
    const canvas = await withTimeout(
      html2canvas(host, {
        scale: 1.5,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        windowWidth: RENDER_WIDTH_PX,
      }),
      RENDER_TIMEOUT_MS,
      'PDF render timed out after 60s',
    );
    const tCanvas = performance.now();
    osLog(
      `html2canvas: ${(tCanvas - tImages).toFixed(0)}ms (canvas ${canvas.width}×${canvas.height})`,
    );

    const imgWidthMm = CONTENT_WIDTH_MM;
    const imgHeightMm = (canvas.height / canvas.width) * imgWidthMm;
    const imgData = canvas.toDataURL('image/jpeg', 0.85);
    const tJpeg = performance.now();
    osLog(`canvas→JPEG: ${(tJpeg - tCanvas).toFixed(0)}ms`);

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

    const dataUrl = pdf.output('datauristring');
    const tDone = performance.now();
    osLog(`pdf.output: ${(tDone - tJpeg).toFixed(0)}ms, total ${(tDone - t0).toFixed(0)}ms`);
    return dataUrl;
  } finally {
    host.innerHTML = '';
  }
}

function waitForImages(root: HTMLElement): Promise<void> {
  // Drop <img> tags with empty or non-http(s) src — those never fire load
  // OR error, so they'd burn the per-image timeout (the original 15s hang
  // was one such avatar with an empty avatarUrl). Replace them with a
  // marker so the layout doesn't shift, and remove them from the wait set.
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src') || '';
    if (!/^https?:\/\//.test(src)) {
      img.remove();
    }
  }
  const imgs = Array.from(root.querySelectorAll('img'));
  if (imgs.length === 0) return Promise.resolve();
  osLog(`waiting for ${imgs.length} image(s)…`);
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
