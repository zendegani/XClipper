import { jsPDF } from 'jspdf';
import type { Document } from '../ast/types';
import { renderPdfFragment } from '../ast/render-pdf-html';

// AST → vector-text PDF.
//
// We inject the rendered fragment into the live document, hand it to
// jsPDF.html(), and write the result. jsPDF.html() preserves text as real
// vector text (selectable + searchable) while using html2canvas for images.
//
// Notes that came out of debugging:
//  - autoPaging: 'text' is the quality-best setting but runs html2canvas
//    once per page boundary, which can take 30s+ on a thread with media.
//    We use 'slice' (jsPDF default) for responsiveness; cards still avoid
//    mid-card splits via page-break-inside:avoid in render-pdf-html.ts.
//  - the offscreen container must be in normal flow, not position:fixed,
//    or html2canvas mis-computes layout in some Chrome versions.
//  - styles are scoped under .t2m-root so injecting into the page doesn't
//    leak into X's UI.
const RENDER_TIMEOUT_MS = 60000;

export async function exportPdf(doc: Document, filenameBase: string): Promise<void> {
  const host = document.createElement('div');
  host.style.cssText = [
    'position:absolute',
    'left:-10000px',
    'top:0',
    'width:680px',
    'background:#fff',
    'visibility:hidden',
  ].join(';');
  // renderPdfFragment escapes every user-derived value (text, URLs, alts,
  // titles) via escapeHtml/escapeAttr — see src/ast/render-pdf-html.ts.
  // The output is not subject to XSS from tweet content.
  host.innerHTML = renderPdfFragment(doc);
  document.body.appendChild(host);

  try {
    await waitForImages(host);

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    await withTimeout(
      pdf.html(host, {
        margin: [10, 10, 10, 10],
        width: 190,           // A4 portrait width minus 2*10mm margins
        windowWidth: 680,     // matches the source container width in px
        image: { type: 'jpeg', quality: 0.92 },
        html2canvas: {
          scale: 1,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false,
          // html2canvas clones the entire document into an offscreen iframe
          // before snapshotting. X.com's <script src="…twimg.com…"> tags get
          // re-evaluated there and the extension/page CSP blocks them, which
          // aborts iframe layout → blank PDF. Our t2m-root fragment is fully
          // self-contained (inline <style>, escaped HTML, no script deps),
          // so dropping every <script> in the clone is safe.
          onclone: (clonedDoc: globalThis.Document) => {
            clonedDoc.querySelectorAll('script').forEach((el) => el.remove());
          },
        },
      }),
      RENDER_TIMEOUT_MS,
      'PDF rendering timed out after 60s',
    );
    pdf.save(`${filenameBase}.pdf`);
  } finally {
    host.remove();
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
