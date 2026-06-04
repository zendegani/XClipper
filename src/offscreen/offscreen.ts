import { jsPDF } from 'jspdf';
import type {
  OffscreenRenderPdfRequest,
  OffscreenRenderPdfResponse,
} from '../types/messages';

// Offscreen-document PDF renderer.
//
// Lives at chrome-extension://<id>/offscreen.html — extension origin, so
// jsPDF.html()'s internal layout iframe never touches X.com's <script>
// tags (the original blocker). Per ADR 0001 PDF text must be real
// selectable text, so we use jsPDF.html() (text drawn as PDF text ops,
// images via html2canvas). Offscreen-only because chrome.storage /
// chrome.downloads aren't reliably exposed there.

const RENDER_WIDTH_PX = 680;
const PAGE_WIDTH_MM = 210;
const PAGE_MARGIN_MM = 10;
const CONTENT_WIDTH_MM = PAGE_WIDTH_MM - 2 * PAGE_MARGIN_MM;
// jsPDF allows custom page sizes up to 14400 units; mm gives us ~14.4m of
// usable height before clamping — comfortably beyond any tweet thread.
const MAX_PAGE_HEIGHT_MM = 14000;
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

    // One-tall-page strategy: measure how tall the laid-out content is and
    // build the PDF with a custom page format that fits the whole thing.
    // This avoids the autoPaging:'text' width-misinterpretation that was
    // zooming text in and slicing columns off, and the slice-mode card
    // splits — until pagination is designed properly, single page wins.
    const contentHeightPx = Math.max(host.offsetHeight, 1);
    const mmPerPx = CONTENT_WIDTH_MM / RENDER_WIDTH_PX;
    const contentHeightMm = contentHeightPx * mmPerPx;
    const pageHeightMm = Math.min(
      contentHeightMm + 2 * PAGE_MARGIN_MM,
      MAX_PAGE_HEIGHT_MM,
    );
    osLog(
      `content ${contentHeightPx}px → page ${PAGE_WIDTH_MM}×${pageHeightMm.toFixed(1)}mm`,
    );

    const pdf = new jsPDF({
      unit: 'mm',
      format: [PAGE_WIDTH_MM, pageHeightMm],
      orientation: 'portrait',
    });
    await withTimeout(
      pdf.html(host, {
        margin: [PAGE_MARGIN_MM, PAGE_MARGIN_MM, PAGE_MARGIN_MM, PAGE_MARGIN_MM],
        width: CONTENT_WIDTH_MM,
        windowWidth: RENDER_WIDTH_PX,
        // autoPaging:false keeps it on the single page we just sized.
        autoPaging: false,
        image: { type: 'jpeg', quality: 0.85 },
        html2canvas: {
          scale: 1,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false,
        },
      }),
      RENDER_TIMEOUT_MS,
      'PDF render timed out after 60s',
    );
    const tRender = performance.now();
    osLog(`pdf.html: ${(tRender - tImages).toFixed(0)}ms`);

    const dataUrl = pdf.output('datauristring');
    const tDone = performance.now();
    osLog(`pdf.output: ${(tDone - tRender).toFixed(0)}ms, total ${(tDone - t0).toFixed(0)}ms`);
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
