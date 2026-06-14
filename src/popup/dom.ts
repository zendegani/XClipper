// Shared element references for the popup. Resolved once at module load — the
// popup script runs after the document is parsed, so getElementById is safe
// here. Both the settings form and the action flows import from this module so
// neither owns the DOM lookups.

// ─── Action buttons + status line ────────────────────────────────────
export const btnDownload = document.getElementById('btn-download') as HTMLButtonElement;
export const btnCopy = document.getElementById('btn-copy') as HTMLButtonElement;
export const btnPdf = document.getElementById('btn-pdf') as HTMLButtonElement;
export const btnObsidian = document.getElementById('btn-obsidian') as HTMLButtonElement;
export const statusEl = document.getElementById('status') as HTMLDivElement;

// ─── Alternate single-export formats (HTML / JSON / TXT / CSV) ────────
export const btnHtml = document.getElementById('btn-html') as HTMLButtonElement;
export const btnJson = document.getElementById('btn-json') as HTMLButtonElement;
export const btnTxt = document.getElementById('btn-txt') as HTMLButtonElement;
export const btnCsv = document.getElementById('btn-csv') as HTMLButtonElement;

// ─── Batch export (bookmarks) ────────────────────────────────────────
export const btnBatch = document.getElementById('btn-batch') as HTMLButtonElement;
export const btnBatchLabel = document.getElementById('btn-batch-label') as HTMLSpanElement;
export const batchProgress = document.getElementById('batch-progress') as HTMLDivElement;
export const batchBarFill = document.getElementById('batch-bar-fill') as HTMLDivElement;
export const batchProgressText = document.getElementById('batch-progress-text') as HTMLSpanElement;
export const btnBatchPause = document.getElementById('btn-batch-pause') as HTMLButtonElement;
export const btnBatchCancel = document.getElementById('btn-batch-cancel') as HTMLButtonElement;
export const batchDedupRow = document.getElementById('batch-dedup-row') as HTMLDivElement;
export const batchDedupText = document.getElementById('batch-dedup-text') as HTMLSpanElement;
export const btnBatchReset = document.getElementById('btn-batch-reset') as HTMLButtonElement;
export const btnBatchResetQueue = document.getElementById('btn-batch-reset-queue') as HTMLButtonElement;
export const batchFormatControls = document.getElementById('batch-format-controls') as HTMLDivElement;
export const batchFormatSelect = document.getElementById('batch-format') as HTMLSelectElement;
export const outSeparate = document.getElementById('out-separate') as HTMLInputElement;
export const outBoth = document.getElementById('out-both') as HTMLInputElement;
export const outCombined = document.getElementById('out-combined') as HTMLInputElement;
export const btnBatchIconBookmarks = document.getElementById('btn-batch-icon-bookmarks') as unknown as SVGElement;
export const btnBatchIconProfile = document.getElementById('btn-batch-icon-profile') as unknown as SVGElement;
export const btnBatchIconSelection = document.getElementById('btn-batch-icon-selection') as unknown as SVGElement;
export const btnBatchIconLikes = document.getElementById('btn-batch-icon-likes') as unknown as SVGElement;
export const btnBatchIconTimeline = document.getElementById('btn-batch-icon-timeline') as unknown as SVGElement;
export const tabBatchBookmarks = document.getElementById('tab-batch-bookmarks') as HTMLButtonElement;
export const tabBatchProfile = document.getElementById('tab-batch-profile') as HTMLButtonElement;
export const tabBatchSelection = document.getElementById('tab-batch-selection') as HTMLButtonElement;
export const tabBatchLikes = document.getElementById('tab-batch-likes') as HTMLButtonElement;
export const tabBatchTimeline = document.getElementById('tab-batch-timeline') as HTMLButtonElement;

// ─── Fast Batch (ADR 0003) ───────────────────────────────────────────
export const viewMain = document.getElementById('view-main') as HTMLElement;
export const fastBatchBar = document.getElementById('fast-batch-bar') as HTMLDivElement;
export const chkFastBatch = document.getElementById('chk-fast-batch') as HTMLInputElement;
export const fastLockedHint = document.getElementById('fast-locked-hint') as HTMLParagraphElement;
export const fastDateRange = document.getElementById('fast-date-range') as HTMLDivElement;
export const fastDateFrom = document.getElementById('fast-date-from') as HTMLInputElement;
export const fastDateTo = document.getElementById('fast-date-to') as HTMLInputElement;
export const fastDateClear = document.getElementById('fast-date-clear') as HTMLButtonElement;
export const fastSteps = document.getElementById('fast-steps') as HTMLDivElement;
export const fastStepPage = document.getElementById('fast-step-page') as HTMLSpanElement;
export const fastStepTweet = document.getElementById('fast-step-tweet') as HTMLSpanElement;
export const fastStepFetch = document.getElementById('fast-step-fetch') as HTMLSpanElement;
export const fastStepExpand = document.getElementById('fast-step-expand') as HTMLSpanElement;
export const batchSection = document.getElementById('batch-section') as HTMLDivElement;

// ─── Settings checkboxes ─────────────────────────────────────────────
export const chkDownloadImages = document.getElementById('chk-download-images') as HTMLInputElement;
export const chkMetadata = document.getElementById('chk-include-metadata') as HTMLInputElement;
export const chkCloseTab = document.getElementById('chk-close-tab') as HTMLInputElement;
export const chkInlineCopies = document.getElementById('chk-inline-copies') as HTMLInputElement;
export const chkShowInline = document.getElementById('chk-show-inline') as HTMLInputElement;
export const chkInlineStats = document.getElementById('chk-inline-stats') as HTMLInputElement;
export const chkIncludeReposts = document.getElementById('chk-include-reposts') as HTMLInputElement;
export const chkObsidianFriendly = document.getElementById('chk-obsidian-friendly') as HTMLInputElement;

// ─── Settings text inputs ────────────────────────────────────────────
export const txtObsidianVault = document.getElementById('txt-obsidian-vault') as HTMLInputElement;
export const txtDownloadFolder = document.getElementById('txt-download-folder') as HTMLInputElement;
export const txtObsidianFolder = document.getElementById('txt-obsidian-folder') as HTMLInputElement;
export const txtObsidianTags = document.getElementById('txt-obsidian-tags') as HTMLInputElement;
export const txtFilenameTemplate = document.getElementById('txt-filename-template') as HTMLInputElement;

// ─── Previews + tags controls ────────────────────────────────────────
export const tagsPreview = document.getElementById('obsidian-tags-preview') as HTMLElement;
export const btnTagsReset = document.getElementById('btn-obsidian-tags-reset') as HTMLButtonElement;
export const tagsAutocomplete = document.getElementById('obsidian-tags-autocomplete') as HTMLDivElement;
export const tagsFieldLabel = document.getElementById('obsidian-tags-label') as HTMLLabelElement;
export const filenamePreview = document.getElementById('filename-preview') as HTMLElement;
