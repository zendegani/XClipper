import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import type { Document } from '../ast/types';
import { renderPdfFragment } from '../ast/render-pdf-html';

// AST → PDF.
//
// Pipeline: render the fragment into a sandbox iframe (so html2canvas's
// document clone never touches X.com's <script> tags → CSP blank PDF), snap
// it to canvas with html2canvas directly, then page-tile the canvas onto an
// A4 PDF with jsPDF.addImage().
//
// We previously used jsPDF.html() which preserves vector text, but it drives
// its own iframe pipeline against window.document — X.com's vendor scripts
// get re-evaluated, CSP blocks them, and the canvas comes back blank. The
// raster approach trades selectable text for reliable output.
const RENDER_TIMEOUT_MS = 60000;

// Render width in px (matches the sandbox iframe width). 680px maps cleanly
// to A4 portrait minus 2×10mm margins (~720 effective px at 96dpi).
const RENDER_WIDTH_PX = 680;

// A4 portrait dimensions in mm.
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PAGE_MARGIN_MM = 10;
const CONTENT_WIDTH_MM = A4_WIDTH_MM - 2 * PAGE_MARGIN_MM;
const CONTENT_HEIGHT_MM = A4_HEIGHT_MM - 2 * PAGE_MARGIN_MM;

export async function exportPdf(doc: Document, filenameBase: string): Promise<void> {
  const sandbox = document.createElement('iframe');
  sandbox.setAttribute('aria-hidden', 'true');
  sandbox.style.cssText = [
    'position:absolute',
    'left:-10000px',
    'top:0',
    `width:${RENDER_WIDTH_PX}px`,
    'height:1px',
    'border:0',
    'visibility:hidden',
  ].join(';');
  document.body.appendChild(sandbox);

  try {
    await new Promise<void>((resolve) => {
      sandbox.addEventListener('load', () => resolve(), { once: true });
      // renderPdfFragment escapes every user-derived value (text, URLs, alts,
      // titles) via escapeHtml/escapeAttr — see src/ast/render-pdf-html.ts.
      sandbox.srcdoc =
        `<!doctype html><html><head><meta charset="utf-8"></head>` +
        `<body style="margin:0;background:#fff">${renderPdfFragment(doc)}</body></html>`;
    });

    const sandboxDoc = sandbox.contentDocument;
    if (!sandboxDoc) throw new Error('Sandbox iframe has no contentDocument');
    const target = sandboxDoc.body.firstElementChild as HTMLElement | null;
    if (!target) throw new Error('Sandbox iframe missing rendered fragment');

    await waitForImages(target);

    const canvas = await withTimeout(
      html2canvas(target, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        windowWidth: RENDER_WIDTH_PX,
      }),
      RENDER_TIMEOUT_MS,
      'PDF rendering timed out after 60s',
    );

    const imgWidthMm = CONTENT_WIDTH_MM;
    const imgHeightMm = (canvas.height / canvas.width) * imgWidthMm;
    const imgData = canvas.toDataURL('image/jpeg', 0.92);

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    // Tile the tall canvas across pages by re-adding it with a negative Y
    // offset on each page — the page's clip rect crops to one page's worth.
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
    pdf.save(`${filenameBase}.pdf`);
  } finally {
    sandbox.remove();
  }
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

// Wait for image elements to finish loading (or fail) before handing off to
// html2canvas. CORS-disallowed loads still resolve — the PDF will fall back
// to alt text / blank boxes for those.
function waitForImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'));
  if (imgs.length === 0) return Promise.resolve();
  return Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const done = (): void => resolve();
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
          }),
    ),
  ).then(() => undefined);
}
