export interface AuthorInfo {
  name: string;
  handle: string;
}

export interface TweetMetadata {
  replies?: number;
  reposts?: number;
  likes?: number;
  bookmarks?: number;
  views?: number;
}

export interface ExtractedContent {
  type: 'tweet' | 'thread' | 'article';
  author: AuthorInfo;
  title?: string;
  // Derived from `body` via renderMarkdown(). Kept on the wire so popup,
  // background, filename, and download consumers keep working unchanged.
  markdown: string;
  sourceUrl: string;
  date: string;
  tweetId: string;
  metadata?: TweetMetadata;
  // Optional during the migration window — older producers may not set it.
  // New extractor always populates it.
  body?: import('../ast/types').Document;
}

export interface ExtractRequest {
  action: 'EXTRACT';
  includeMetadata?: boolean;
}

export interface DownloadRequest {
  action: 'DOWNLOAD_MD';
  content: string;
  filename: string;
  images?: { url: string; filename: string }[];
}

export interface ExportPdfRequest {
  action: 'EXPORT_PDF';
}

// Content → background: render this fragment to a PDF in the offscreen doc.
// Background spins up the offscreen page (extension origin → no x.com CSP)
// and forwards via OffscreenRenderPdfRequest below.
export interface PdfRenderRequest {
  action: 'PDF_RENDER_REQUEST';
  html: string;
  filenameBase: string;
}

// Background → offscreen page. Offscreen returns the rendered PDF as a data
// URL; chrome.storage / chrome.downloads aren't reliably exposed in offscreen
// documents, so the background handles those.
export interface OffscreenRenderPdfRequest {
  action: 'OFFSCREEN_RENDER_PDF';
  html: string;
}

export interface OffscreenRenderPdfResponse {
  success: boolean;
  dataUrl?: string;
  error?: string;
}

export interface PdfRenderResponse {
  success: boolean;
  error?: string;
}

// Print-via-browser spike (ADR 0001 follow-up). Content asks background to
// open chrome-extension://<id>/print.html in a new tab; the page hydrates
// the supplied HTML and calls window.print(), letting the user save the
// real Chrome-rendered output via the print dialog.
export interface PdfPrintRequest {
  action: 'PDF_PRINT_REQUEST';
  html: string;
  filenameBase: string;
}

export interface ExtractResponse {
  success: boolean;
  data?: ExtractedContent;
  error?: string;
}

export type MessageRequest =
  | ExtractRequest
  | DownloadRequest
  | ExportPdfRequest
  | PdfRenderRequest
  | OffscreenRenderPdfRequest
  | PdfPrintRequest;
