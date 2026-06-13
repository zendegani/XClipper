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
  // MIME type for the data: URL. Defaults to text/markdown. Set by the
  // alternate-format exports (HTML/JSON/TXT/CSV) so the saved file carries the
  // right type; Chrome still names the file from `filename`'s extension.
  mime?: string;
}

export interface ExportPdfRequest {
  action: 'EXPORT_PDF';
}

// Offscreen theme watcher → background: the current OS color scheme, used to
// pick a toolbar icon that stays visible on a light or dark Chrome toolbar.
export interface ThemeReport {
  action: 'XCLIPPER_THEME';
  dark: boolean;
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

// Extension page → background: start a batch export job over the given status
// permalinks (ADR 0002, Phase A). The background owns the queue, the hidden
// worker tab, throttle/timeout policy, and the folder sink.
export interface BatchStartRequest {
  action: 'BATCH_START';
  urls: string[];
  // Which surface launched the job — the popup scopes progress display to
  // the matching tab.
  origin?: 'bookmarks' | 'profile' | 'selection' | 'likes';
  // Profile owner's handle when origin === 'profile'.
  handle?: string;
  // File format + grouping for the job (defaults: 'md' / 'separate'). PDF
  // can't batch, so it's not an option here.
  format?: 'md' | 'txt' | 'html' | 'json' | 'csv';
  output?: 'separate' | 'both' | 'combined';
}

// Extension page → background: add newly-loaded permalinks to the running
// job's queue (the user scrolled in more posts on the same source).
export interface BatchAppendRequest {
  action: 'BATCH_APPEND';
  urls: string[];
}

export interface BatchStartResponse {
  success: boolean;
  // Items queued after normalization + dedupe + cap.
  total?: number;
  error?: string;
}

// Extension page → background: control a running batch job.
export interface BatchControlRequest {
  action: 'BATCH_CONTROL';
  control: 'cancel' | 'pause' | 'resume';
}

// Extension page → background: snapshot of the current batch job, polled by
// the popup progress UI (the popup may close and reopen mid-job, so progress
// must be queryable rather than pushed).
export interface BatchStatusRequest {
  action: 'BATCH_STATUS';
}

export interface BatchStatusResponse {
  job?: {
    id: string;
    status: 'running' | 'paused' | 'done' | 'cancelled';
    origin?: 'bookmarks' | 'profile' | 'selection' | 'likes';
    // Set when origin === 'profile' — the popup only offers "add to queue"
    // on the same profile.
    handle?: string;
    total: number;
    completed: number;
    failed: number;
    folder: string;
    // Status ids already in the queue (processed or pending), so the popup
    // can exclude them from the "new items to add" count without re-adding.
    queuedIds: string[];
    // Why the job auto-paused (login/rate-limit wall, or a run of failures), so
    // the popup can explain the stop instead of just showing "Paused".
    pauseReason?: string;
  };
}

// Popup → injector content script: return the status permalinks harvested
// from the current page's timeline so far (timelines are virtualized, so the
// injector accumulates URLs as cells scroll through). `source` says what
// kind of page the injector recognizes — null means batch export doesn't
// apply here.
export interface HarvestRequest {
  action: 'XCLIPPER_HARVEST';
}

export interface HarvestResponse {
  source: 'bookmarks' | 'profile' | 'likes' | null;
  // Profile owner's handle when source is 'profile'.
  handle?: string;
  urls: string[];
}

// Popup → injector content script: enter/exit tweet selection mode — the
// injector overlays checkboxes on timeline cells and a floating export bar.
export interface SelectionRequest {
  action: 'XCLIPPER_SELECTION';
  enable: boolean;
}

// Content (worker tab) → background: finished result for the batch item the
// worker tab currently shows. `url` is the page the result came from, so the
// orchestrator can drop late or duplicate reports from a previous navigation.
export interface BatchItemResultMessage {
  action: 'BATCH_ITEM_RESULT';
  url: string;
  success: boolean;
  markdown?: string;
  filename?: string;
  images?: { url: string; filename: string }[];
  // The item's AST, carried for the per-job JSON sink (ADR 0002 #11).
  doc?: import('../ast/types').Document;
  error?: string;
  // Set when the worker landed on a login or rate-limit wall instead of the
  // tweet (ADR 0002 #7). A session-level stop, not a per-item failure: the
  // orchestrator pauses the whole job with this reason rather than recording it
  // and hammering on. Human-readable; surfaced in the popup's paused state.
  interstitial?: string;
  // Diagnostic phase timings for perf tuning, logged by the background (not
  // persisted or shown to users): waitForArticle vs. extract (thread-walk + AST).
  timings?: { waitMs: number; extractMs: number };
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
  | ContextUrlRequest
  | BatchStartRequest
  | BatchControlRequest
  | BatchStatusRequest
  | HarvestRequest
  | SelectionRequest
  | BatchItemResultMessage;
