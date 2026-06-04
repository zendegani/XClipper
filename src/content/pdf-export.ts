import type { Document } from '../ast/types';
import type { PdfRenderResponse } from '../types/messages';
import { renderPdfFragment } from '../ast/render-pdf-html';

// PDF export delegates to the print spike (ADR 0001 follow-up): we send the
// rendered fragment to the background worker, which opens a print-preview
// tab in extension origin and triggers window.print(). Chrome's native
// print engine produces selectable text, clickable links, real Unicode and
// emoji — everything the prior html2canvas / jsPDF paths couldn't.
export async function exportPdf(doc: Document, filenameBase: string): Promise<void> {
  const html = renderPdfFragment(doc);
  const resp = (await chrome.runtime.sendMessage({
    action: 'PDF_PRINT_REQUEST',
    html,
    filenameBase,
  })) as PdfRenderResponse | undefined;
  if (!resp?.success) {
    throw new Error(resp?.error || 'PDF print failed');
  }
}
