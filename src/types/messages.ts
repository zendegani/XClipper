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

// Content → background: open the print-preview tab so Chrome's native print
// engine can render and save the PDF. The browser handles selectable text,
// clickable links, Unicode, and pagination — see ADR 0001 "Renderer
// decisions".
export interface PdfPrintRequest {
  action: 'PDF_PRINT_REQUEST';
  html: string;
  filenameBase: string;
}

export interface PdfPrintResponse {
  success: boolean;
  error?: string;
}

export interface ExtractResponse {
  success: boolean;
  data?: ExtractedContent;
  error?: string;
}

// Background → content: run an in-place extraction on the current tab, used by
// the inline button / context menu when the target tweet is already the open
// permalink. `subAction` selects the flow; `pdf` routes to the PDF pipeline.
export interface AutoExtractRequest {
  action: 'XCLIPPER_AUTOEXTRACT';
  subAction: 'download' | 'copy' | 'obsidian' | 'pdf';
  single?: boolean;
}

// Injector (content) → background: report the tweet permalink under the cursor
// on `contextmenu`, used as the fallback target when the menu item fires over
// an area that isn't a status link. `null` clears the last-known url.
export interface ContextUrlRequest {
  action: 'XCLIPPER_CTX_URL';
  url: string | null;
}

export type MessageRequest =
  | ExtractRequest
  | DownloadRequest
  | ExportPdfRequest
  | PdfPrintRequest
  | AutoExtractRequest
  | ContextUrlRequest;
