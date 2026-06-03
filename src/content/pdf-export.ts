import { jsPDF } from 'jspdf';
import type { Document } from '../ast/types';
import { renderPdfFragment } from '../ast/render-pdf-html';

// AST → vector-text PDF.
//
// We inject the rendered fragment into an offscreen container in the live
// document and hand it to jsPDF.html() with autoPaging:'text'. That mode
// renders text as real vector text in the PDF (selectable + searchable +
// real link annotations) while still using html2canvas under the hood for
// images. The earlier html2pdf-based path always rasterized the whole page.
//
// Styles are scoped under .t2m-root so injecting into the page can't bleed
// into X's UI.
export async function exportPdf(doc: Document, filenameBase: string): Promise<void> {
  const host = document.createElement('div');
  host.style.cssText = [
    'position:fixed',
    'left:-99999px',
    'top:0',
    'width:680px',
    'background:#fff',
    'z-index:-1',
    'pointer-events:none',
  ].join(';');
  // renderPdfFragment escapes every user-derived value (text, URLs, alts,
  // titles) via escapeHtml/escapeAttr — see src/ast/render-pdf-html.ts.
  // The output is not subject to XSS from tweet content.
  host.innerHTML = renderPdfFragment(doc);
  document.body.appendChild(host);

  try {
    await waitForImages(host);

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    // 'text' autoPaging walks text spans and breaks pages on text-flow
    // boundaries; combined with the .page-break-inside:avoid rules in our
    // CSS, this keeps cards from being sliced.
    await pdf.html(host, {
      autoPaging: 'text',
      margin: [10, 10, 10, 10],
      width: 190,           // A4 portrait width minus 2*10mm margins
      windowWidth: 680,     // matches the source container width in px
      image: { type: 'jpeg', quality: 0.92 },
      html2canvas: {
        scale: 0.5,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
      },
    });
    pdf.save(`${filenameBase}.pdf`);
  } finally {
    host.remove();
  }
}

// Wait for the rendered images to finish loading (or fail) so html2canvas
// doesn't snapshot blank tiles. CORS-disallowed loads still resolve here —
// the PDF will fall back to alt text / empty boxes for those.
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
