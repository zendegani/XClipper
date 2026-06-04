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
  // Render inside a dedicated sandbox iframe rather than directly in the page.
  // html2canvas clones the input element's ownerDocument; if that's X.com's
  // document, the clone includes <script src="…twimg.com…"> tags that get
  // re-evaluated in html2canvas's offscreen iframe and trip CSP → blank PDF.
  // Using an iframe whose document contains only our self-contained fragment
  // (inline <style>, no scripts) avoids the issue entirely. onclone runs
  // *after* scripts have already executed, so it can't be used as a fix.
  const sandbox = document.createElement('iframe');
  sandbox.setAttribute('aria-hidden', 'true');
  sandbox.style.cssText = [
    'position:absolute',
    'left:-10000px',
    'top:0',
    'width:680px',
    'height:1px',
    'border:0',
    'visibility:hidden',
  ].join(';');
  // srcdoc is set after append so the load event fires reliably.
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

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    await withTimeout(
      pdf.html(target, {
        margin: [10, 10, 10, 10],
        width: 190,           // A4 portrait width minus 2*10mm margins
        windowWidth: 680,     // matches the sandbox iframe width in px
        image: { type: 'jpeg', quality: 0.92 },
        html2canvas: {
          scale: 1,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false,
        },
      }),
      RENDER_TIMEOUT_MS,
      'PDF rendering timed out after 60s',
    );
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
