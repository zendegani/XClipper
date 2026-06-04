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
const A4_WIDTH_MM = 210;
const PAGE_MARGIN_MM = 10;
const CONTENT_WIDTH_MM = A4_WIDTH_MM - 2 * PAGE_MARGIN_MM;
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

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    await withTimeout(
      pdf.html(host, {
        // autoPaging:'text' walks text nodes and breaks at line boundaries
        // instead of slicing the canvas mid-line. Slower than the default
        // 'slice' but it's what keeps card layout intact across pages.
        autoPaging: 'text',
        margin: [PAGE_MARGIN_MM, PAGE_MARGIN_MM, PAGE_MARGIN_MM, PAGE_MARGIN_MM],
        width: CONTENT_WIDTH_MM,
        windowWidth: RENDER_WIDTH_PX,
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
