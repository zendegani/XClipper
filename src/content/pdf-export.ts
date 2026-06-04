import type { Document } from '../ast/types';
import type { PdfPrintResponse } from '../types/messages';
import { renderPdfFragment } from '../ast/render-pdf-html';

// PDF export delegates to background, which opens a print-preview tab in
// extension origin and triggers window.print(). Chrome's native print
// engine produces selectable text, clickable links, real Unicode + emoji,
// and pagination — none of which the prior jsPDF / html2canvas paths
// could deliver without effectively building a layout engine. See
// ADR 0001 → "Renderer decisions".
export async function exportPdf(doc: Document, filenameBase: string): Promise<void> {
  const html = renderPdfFragment(doc);
  const resp = (await chrome.runtime.sendMessage({
    action: 'PDF_PRINT_REQUEST',
    html,
    filenameBase,
  })) as PdfPrintResponse | undefined;
  if (!resp?.success) {
    throw new Error(resp?.error || 'PDF print failed');
  }
}
