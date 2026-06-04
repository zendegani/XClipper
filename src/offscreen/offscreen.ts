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
// tags. Offscreen documents only have access to chrome.runtime
// reliably; chrome.storage and chrome.downloads belong to the background
// worker, which calls into us solely for the canvas → PDF data URL.

const RENDER_WIDTH_PX = 680;
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PAGE_MARGIN_MM = 10;
const CONTENT_WIDTH_MM = A4_WIDTH_MM - 2 * PAGE_MARGIN_MM;
const CONTENT_HEIGHT_MM = A4_HEIGHT_MM - 2 * PAGE_MARGIN_MM;
const RENDER_TIMEOUT_MS = 60000;
const IMAGE_LOAD_TIMEOUT_MS = 15000;

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

  // renderPdfFragment escapes every user-derived value (text, URLs, alts,
  // titles) via escapeHtml/escapeAttr — see src/ast/render-pdf-html.ts.
  // The offscreen page is extension-owned and not reachable from the web,
  // so this DOM injection is safe.
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

    return pdf.output('datauristring');
  } finally {
    host.innerHTML = '';
  }
}

function waitForImages(root: HTMLElement): Promise<void> {
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
