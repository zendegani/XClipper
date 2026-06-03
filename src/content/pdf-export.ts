import html2pdf from 'html2pdf.js';
import type { Document } from '../ast/types';
import { renderPdfHtml } from '../ast/render-pdf-html';

// Renders the AST to a Twitter-styled HTML document, injects it into a
// hidden offscreen container, and hands it to html2pdf for vector-text PDF
// generation + browser download. The container is removed when the user's
// download is committed (or the call errors).
export async function exportPdf(doc: Document, filenameBase: string): Promise<void> {
  const html = renderPdfHtml(doc);
  const host = createHiddenHost();
  try {
    // Use an iframe so the page's CSS (and X's font stack) can't leak in.
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'border:none;width:680px;height:1px;';
    host.appendChild(iframe);
    await writeIframe(iframe, html);

    const target = iframe.contentDocument?.body;
    if (!target) throw new Error('PDF export: iframe body unavailable');

    // The shipped html2pdf.js .d.ts is incomplete (missing pagebreak, partial
    // chain typing). Treat as any here so config still validates structurally
    // at the JS level without us pretending we know more than the .d.ts does.
    const opts = {
      margin: [12, 0, 12, 0],
      filename: `${filenameBase}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, allowTaint: true, logging: false, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (html2pdf as any)().set(opts).from(target).save();
  } finally {
    host.remove();
  }
}

function createHiddenHost(): HTMLElement {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;width:0;height:0;overflow:hidden;pointer-events:none;';
  document.body.appendChild(host);
  return host;
}

function writeIframe(iframe: HTMLIFrameElement, html: string): Promise<void> {
  return new Promise((resolve) => {
    iframe.srcdoc = html;
    const onLoad = () => {
      iframe.removeEventListener('load', onLoad);
      // Give images a tick to start streaming so html2canvas can rasterize
      // them (CORS-permitting). The PDF lib also waits internally.
      setTimeout(resolve, 50);
    };
    iframe.addEventListener('load', onLoad);
  });
}
