// Product labels: manual = Scroll, auto = Auto Full, super = Auto Fast.
// Keep stored values and message contracts compatible. See GLOSSARY.md.
export type BatchEngine = 'manual' | 'auto' | 'super';
export type BatchSource = 'bookmarks' | 'profile' | 'selection' | 'likes' | 'timeline';
export type GraphqlBatchSource = 'bookmarks' | 'profile' | 'likes';
export type FetchMode = 'recent' | 'resume' | 'dateRange';

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

// ─── Popup single export (issue #191) ───
// These go over a port that the popup opens to the tab (chrome.tabs.connect),
// not through the background router. Chrome closes the port when the popup
// closes, so the content script knows at once that the popup is gone.
export const SINGLE_EXPORT_PORT = 'xclipper-single-export';

export type SingleExportTarget = 'download' | 'copy' | 'obsidian';

// Popup → content: get the post. While the popup is open, it receives the post
// and does the last step itself (clipboard, Obsidian, download). If the popup
// closes first, the content script does that step with `settings`, the popup's
// form at the time of the click.
export interface SingleExportRequest {
  action: 'SINGLE_EXPORT';
  target: SingleExportTarget;
  // The Download / Copy format. Add to Obsidian always sends 'md'.
  format: import('../shared/settings').BatchFormat;
  settings: import('../shared/settings').Settings;
}

// Content → popup: the extraction result.
export interface SingleExportResultMessage {
  action: 'SINGLE_EXPORT_RESULT';
  response: ExtractResponse;
}

// Popup → content: the popup now does the last step, so the content script
// must not do it when the popup closes.
export interface SingleExportClaimMessage {
  action: 'SINGLE_EXPORT_CLAIM';
}

// Popup → content: download this file. This also claims the export. The
// content script sends DOWNLOAD_MD to the background, because the background
// can take long to answer (zip mode fetches the media first). If the popup has
// closed when the answer comes, the content script shows it in a toast.
export interface SingleExportDownloadMessage {
  action: 'SINGLE_EXPORT_DOWNLOAD';
  request: DownloadRequest;
}

// Content → popup: the error to show, or null when Chrome started the download.
export interface SingleExportDownloadedMessage {
  action: 'SINGLE_EXPORT_DOWNLOADED';
  error: string | null;
}

// Content → popup: an export that a closed popup started still runs (`busy`)
// or has ended (null). Sent when a popup connects during that export, and when
// that export ends.
export interface SingleExportState {
  action: 'SINGLE_EXPORT_STATE';
  busy: SingleExportTarget | null;
}

export interface DownloadRequest {
  action: 'DOWNLOAD_MD';
  content: string;
  filename: string;
  images?: { url: string; filename: string }[];
  // Single export only: pack `content` and `images` into one .zip instead of
  // writing the file and downloading each media item beside it. The media
  // bytes are fetched in the background so they can go into the archive.
  zip?: boolean;
  // MIME type for the data: URL. Defaults to text/markdown. Set by the
  // alternate-format exports (HTML/JSON/TXT/CSV) so the saved file carries the
  // right type; Chrome still names the file from `filename`'s extension.
  mime?: string;
}

export interface DownloadResponse {
  success: boolean;
  downloadId?: number;
  error?: string;
}

// Single export, local-media saving only: ask the background to resolve this
// post's MP4 URLs through the captured X session, since the DOM only exposes
// posters. Answered with an empty list whenever that isn't possible — see
// resolve-video.ts.
export interface ResolveVideoUrlsRequest {
  action: 'RESOLVE_VIDEO_URLS';
  tweetId: string;
}

export interface ResolveVideoUrlsResponse {
  // [poster path, MP4 URL] pairs — a Map doesn't survive the message boundary.
  urls: [string, string][];
}

// Single export: ask the background for the full text of the posts X showed
// only as a preview (issue #184). `tweetId` is the requested post. Answered
// with the texts it found; a post left out stays cut off — see
// resolve-full-text.ts.
export interface ResolveFullTextRequest {
  action: 'RESOLVE_FULL_TEXT';
  tweetId: string;
  posts: { tweetId: string; handle: string }[];
}

export interface ResolveFullTextResponse {
  // [post id, full text] pairs — a Map doesn't survive the message boundary.
  texts: [string, import('../ast/types').InlineNode[]][];
}

// Content (full-text window) → background: the text of the post this page
// shows in full. No `text` when the page didn't show it.
export interface FullTextResultMessage {
  action: 'FULL_TEXT_RESULT';
  tweetId: string;
  text?: import('../ast/types').InlineNode[];
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

// Automatic single-post trigger, unrelated to the Auto Full batch engine.
// Background → content: run an in-place extraction on the current tab, used by
// the inline button / context menu when the target tweet is already the open
// permalink. `subAction` selects the flow; `pdf` routes to the PDF pipeline.
export interface AutoExtractRequest {
  action: 'XCLIPPER_AUTOEXTRACT';
  subAction:
    | 'download'
    | 'copy'
    | 'obsidian'
    | 'pdf'
    | 'copy-txt'
    | 'txt'
    | 'html'
    | 'json'
    | 'csv';
  single?: boolean;
}

// Scroll engine: start a DOM worker-window job over the given status permalinks
// (ADR 0002). BATCH_* action strings are retained for compatibility.
export interface ManualBatchStartRequest {
  action: 'BATCH_START';
  urls: string[];
  // Which surface launched the job — the popup scopes progress display to
  // the matching tab.
  origin?: BatchSource;
  // Profile owner's handle when origin === 'profile'.
  handle?: string;
  // File format + grouping for the job (defaults: 'md' / 'separate'). PDF
  // can't batch, so it's not an option here.
  format?: 'md' | 'txt' | 'html' | 'json' | 'csv';
  output?: 'separate' | 'both' | 'combined';
}

// Extension page → background: add newly-loaded permalinks to the running
// job's queue (the user scrolled in more posts on the same source).
export interface ManualBatchAppendRequest {
  action: 'BATCH_APPEND';
  urls: string[];
}

export interface ManualBatchStartResponse {
  success: boolean;
  // Items queued after normalization + dedupe + cap.
  total?: number;
  error?: string;
}

// Extension page → background: control a running Scroll job.
export interface ManualBatchControlRequest {
  action: 'BATCH_CONTROL';
  control: 'cancel' | 'pause' | 'resume';
}

// Extension page → background: snapshot of the current Scroll job, polled by
// the popup progress UI (the popup may close and reopen mid-job, so progress
// must be queryable rather than pushed).
export interface ManualBatchStatusRequest {
  action: 'BATCH_STATUS';
}

export interface ManualBatchStatusResponse {
  job?: {
    id: string;
    status: 'running' | 'paused' | 'done' | 'cancelled';
    origin?: BatchSource;
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
  source: 'bookmarks' | 'profile' | 'likes' | 'timeline' | null;
  // Profile owner's handle when source is 'profile'.
  handle?: string;
  urls: string[];
}

// Popup → injector: empty the gathered collection so it restarts from the
// current scroll position ("Reset queue"). Re-seeds from the viewport.
export interface HarvestResetRequest {
  action: 'XCLIPPER_HARVEST_RESET';
}
export interface HarvestResetResponse {
  count: number;
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
export interface ManualBatchItemResultMessage {
  action: 'BATCH_ITEM_RESULT';
  url: string;
  success: boolean;
  // The item's AST. The background renders every file from it (batch-sink.ts
  // renderItem), the same way for every engine, and keeps it for data.json.
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

// ─── GraphQL acquisition: Auto Full and Auto Fast (ADR 0003) ──────────────────
// Progress is polled because the popup can close mid-run. These engines have
// no per-item worker tab. FAST_BATCH_* action strings are kept for compatibility.
export interface GraphqlBatchStartRequest {
  action: 'FAST_BATCH_START';
  // Timeline and Selection use Scroll.
  source?: GraphqlBatchSource;
  // Profile owner's handle — used to skip reposts (export only their own posts).
  handle?: string;
  // Optional YYYY-MM-DD bounds on the tweet's date; out-of-range items are
  // skipped (and never expanded), so the TweetDetail budget is spared.
  fromDate?: string;
  toDate?: string;
  // Auto Full by default; false selects Auto Fast. Both expand articles and replies to
  // other authors, even when self-thread expansion is disabled.
  expandThreads?: boolean;
  // Fetch mode (#83): 'recent' starts from the top of the feed
  // (newly-added items); 'resume' continues from the saved per-source cursor
  // (backfill a large feed across sessions); 'dateRange' deep-scans from the top
  // for posts tweeted within fromDate..toDate — it dedups against history but
  // never touches the resume cursor, so it can't confuse a Resume backfill.
  paginate?: FetchMode;
}
export interface GraphqlBatchStartResponse {
  success: boolean;
  error?: string;
}
export interface GraphqlBatchCancelRequest {
  action: 'FAST_BATCH_CANCEL';
}
export interface GraphqlBatchStatusRequest {
  action: 'FAST_BATCH_STATUS';
}
// Readiness for the step lights: are the needed request templates captured?
export interface GraphqlBatchReadyRequest {
  action: 'FAST_BATCH_READY';
  source?: GraphqlBatchSource;
}
export interface GraphqlBatchReadyResponse {
  feed: boolean; // the source's feed template was observed (page visited)
  tweetDetail: boolean; // a tweet was opened (expansion possible)
}
export interface GraphqlBatchProgress {
  status: 'idle' | 'running' | 'done' | 'cancelled' | 'error';
  // Human-readable phase for the progress label (e.g. "Fetching bookmarks").
  phase: string;
  // Which source + (for profile) whose posts — so the popup can show who's
  // running even after navigating elsewhere / reopening.
  source?: GraphqlBatchSource;
  handle?: string;
  done: number;
  total: number;
  exported: number;
  skipped: number;
  folder?: string;
  // Stopped early because X throttled TweetDetail — some items kept as stubs.
  rateLimited?: boolean;
  // Could not start: no TweetDetail request observed yet (open a tweet once).
  needTweetDetail?: boolean;
  error?: string;
}
export interface GraphqlBatchStatusResponse {
  progress: GraphqlBatchProgress;
}

export type MessageRequest =
  | DownloadRequest
  | ResolveVideoUrlsRequest
  | ResolveFullTextRequest
  | FullTextResultMessage
  | ExportPdfRequest
  | PdfPrintRequest
  | AutoExtractRequest
  | ContextUrlRequest
  | ManualBatchStartRequest
  | ManualBatchAppendRequest
  | ManualBatchControlRequest
  | ManualBatchStatusRequest
  | HarvestRequest
  | HarvestResetRequest
  | SelectionRequest
  | ManualBatchItemResultMessage
  | GraphqlBatchStartRequest
  | GraphqlBatchCancelRequest
  | GraphqlBatchStatusRequest
  | GraphqlBatchReadyRequest;
